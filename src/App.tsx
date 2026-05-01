import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area
} from 'recharts';
import { 
  Menu, X, Wifi, WifiOff, Plus, Trash2, LogOut, UserPlus, ShieldCheck, Lock, LayoutDashboard, Settings
} from 'lucide-react';
import { BRANCHES, TARGET_DATA, PREVIOUS_YEAR_DATA } from './constants';
import { cn } from './lib/utils';
import { db } from './firebase';
import { 
  collection, 
  doc, 
  setDoc, 
  deleteDoc,
  onSnapshot, 
  getDocFromServer,
  Timestamp 
} from 'firebase/firestore';

// --- Types ---
type MetricKey = keyof typeof TARGET_DATA;
type ViewType = 'dashboard' | 'targets' | 'admin';

interface AdminUser {
  name: string;
  employeeId: string;
  registeredAt: any;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return errInfo;
};

interface MetricInfo {
  label: string;
  unit: string;
  color: string;
  description: string;
}

const METRIC_CONFIG: Record<MetricKey, MetricInfo> = {
  visitors: { 
    label: '입장객', 
    unit: '명', 
    color: '#3b82f6',
    description: '전체 관람객 수'
  },
  ticketSales: { 
    label: '티켓매출', 
    unit: '원', 
    color: '#10b981',
    description: '영화 티켓 판매 총액'
  },
  atp: { 
    label: 'ATP', 
    unit: '원', 
    color: '#f59e0b',
    description: '객단가 (Average Ticket Price)'
  },
  concessionSales: { 
    label: '매점순매출', 
    unit: '원', 
    color: '#ec4899',
    description: '팝콘, 음료 등 매점 매출'
  },
  cpp: { 
    label: 'CPP', 
    unit: '원', 
    color: '#8b5cf6',
    description: '매점 객단가 (Concession Per Person)'
  },
  rentalIncome: { 
    label: '임대매장', 
    unit: '원', 
    color: '#6366f1',
    description: '임대 수익'
  },
  laborCost: { 
    label: '드리미 인건비', 
    unit: '원', 
    color: '#ef4444',
    description: '현장 인력 인건비'
  }
};

// --- Constants ---
const FIXED_METRIC_ORDER = ['visitors', 'ticketSales', 'atp', 'concessionSales', 'cpp', 'rentalIncome', 'laborCost'];

const getSortedMetricKeys = (config: Record<string, any>) => {
  return Object.keys(config).sort((a, b) => {
    const indexA = FIXED_METRIC_ORDER.indexOf(a);
    const indexB = FIXED_METRIC_ORDER.indexOf(b);
    
    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    
    return a.localeCompare(b);
  });
};

// --- Helper Functions ---
const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('ko-KR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
};

const formatValue = (value: number, unit: string) => {
  if (unit === '원') return `${formatCurrency(value)}원`;
  return `${formatCurrency(value)}${unit}`;
};

// --- Components ---

const ComparisonCard = ({ 
  label, 
  value, 
  subValue,
  actual,
  target,
  unit = '',
  type = 'default'
}: { 
  label: string; 
  value: number; 
  subValue?: string;
  actual?: number;
  target?: number;
  unit?: string;
  type?: 'default' | 'percentage';
}) => {
  return (
    <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">{label}</p>
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-baseline gap-2 mb-1">
            <h4 className="text-2xl font-black text-slate-900">
              {type === 'percentage' ? `${value.toFixed(1)}%` : formatCurrency(value)}
            </h4>
            {subValue && <span className="text-xs font-bold text-slate-400">{subValue}</span>}
          </div>
          {actual !== undefined && target !== undefined && (
            <div className="flex items-center gap-3 text-[11px] font-bold">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">실적</span>
                <span className="text-slate-700">{formatValue(actual, unit)}</span>
              </div>
              <div className="w-px h-2 bg-slate-200" />
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">{label.includes('전년') ? '전년' : '목표'}</span>
                <span className="text-slate-700">{formatValue(target, unit)}</span>
              </div>
            </div>
          )}
        </div>
        {type === 'percentage' && (
          <div className={cn(
            "px-2.5 py-1 rounded-lg text-[10px] font-black",
            value >= 100 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
          )}>
            {value >= 100 ? '초과달성' : '미달성'}
          </div>
        )}
      </div>
    </div>
  );
};

export default function App() {
  const [selectedBranch, setSelectedBranch] = useState(BRANCHES[0]);
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>('visitors');
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [activeView, setActiveView] = useState<ViewType>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [editingMetric, setEditingMetric] = useState<string | null>(null);
  const [resetConfirmMetric, setResetConfirmMetric] = useState<string | null>(null);
  const [isSynced, setIsSynced] = useState(false);
  const [metricConfig, setMetricConfig] = useState<Record<string, MetricInfo>>(METRIC_CONFIG);
  const [isAddMetricModalOpen, setIsAddMetricModalOpen] = useState(false);
  const [newMetricLabel, setNewMetricLabel] = useState('');
  const [newMetricUnit, setNewMetricUnit] = useState('');
  const [deleteConfirmMetric, setDeleteConfirmMetric] = useState<string | null>(null);

  // Admin & Login State
  const [isLoggedIn, setIsLoggedIn] = useState(sessionStorage.getItem('isLoggedIn') === 'true');
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loginName, setLoginName] = useState('');
  const [loginId, setLoginId] = useState('');
  const [loginError, setLoginError] = useState('');
  const [newAdminName, setNewAdminName] = useState('');
  const [newAdminId, setNewAdminId] = useState('');

  // --- State & Data Persistence ---
  const [targets, setTargets] = useState<any>(TARGET_DATA);
  const [prevYearData, setPrevYearData] = useState<any>(PREVIOUS_YEAR_DATA);
  const [actual2026Data, setActual2026Data] = useState<any>({});

  // Firestore Sync Listener
  useEffect(() => {
    const branchDataPath = 'branchData';
    const configPath = 'appConfig';

    // Sync Metric Config
    const unsubscribeConfig = onSnapshot(doc(db, configPath, 'metrics'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.metrics) {
          setMetricConfig(data.metrics);
        }
      } else {
        // Initialize config if it doesn't exist
        setDoc(doc(db, configPath, 'metrics'), { metrics: METRIC_CONFIG });
      }
    });

    const unsubscribeData = onSnapshot(collection(db, branchDataPath), (snapshot) => {
      const newTargets = { ...TARGET_DATA } as any;
      const newPrevYear = { ...PREVIOUS_YEAR_DATA } as any;
      const newActual = {} as any;

      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        const { branch, metric, type, values } = data;
        
        if (type === 'target') {
          if (!newTargets[metric]) newTargets[metric] = {};
          newTargets[metric][branch] = values;
        } else if (type === 'prevYear') {
          if (!newPrevYear[metric]) newPrevYear[metric] = {};
          newPrevYear[metric][branch] = values;
        } else if (type === 'actual') {
          if (!newActual[metric]) newActual[metric] = {};
          newActual[metric][branch] = values;
        }
      });

      setTargets(newTargets);
      setPrevYearData(newPrevYear);
      setActual2026Data(newActual);
      setIsSynced(true);
    }, (error) => {
      setIsSynced(false);
      handleFirestoreError(error, OperationType.LIST, branchDataPath);
    });

    // Sync Admins
    const unsubscribeAdmins = onSnapshot(collection(db, 'admins'), (snapshot) => {
      const adminList: AdminUser[] = [];
      snapshot.docs.forEach((doc) => {
        adminList.push(doc.data() as AdminUser);
      });
      setAdmins(adminList);
      
      // If no admins exist, create a default one for first access
      if (snapshot.empty) {
        const defaultAdmin = {
          name: '관리자',
          employeeId: 'admin123',
          registeredAt: Timestamp.now()
        };
        setDoc(doc(db, 'admins', 'admin123'), defaultAdmin);
      }
    });

    // Test connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          setIsSynced(false);
        }
      }
    };
    testConnection();

    return () => {
      unsubscribeConfig();
      unsubscribeData();
      unsubscribeAdmins();
    };
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const user = admins.find(a => a.name === loginName && a.employeeId === loginId);
    if (user) {
      setIsLoggedIn(true);
      sessionStorage.setItem('isLoggedIn', 'true');
      setLoginError('');
    } else {
      setLoginError('이름 또는 사번이 일치하지 않습니다.');
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    sessionStorage.removeItem('isLoggedIn');
    setActiveView('dashboard');
  };

  const registerAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdminName || !newAdminId) return;

    const newAdmin = {
      name: newAdminName,
      employeeId: newAdminId,
      registeredAt: Timestamp.now()
    };

    try {
      await setDoc(doc(db, 'admins', newAdminId), newAdmin);
      setNewAdminName('');
      setNewAdminId('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `admins/${newAdminId}`);
    }
  };

  const deleteAdmin = async (id: string) => {
    // Prevent deleting the last admin
    if (admins.length <= 1) {
      return;
    }
    try {
      await deleteDoc(doc(db, 'admins', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `admins/${id}`);
    }
  };

  const saveToFirestore = async (metric: string, branch: string, type: 'target' | 'actual' | 'prevYear', values: number[]) => {
    const dataId = `${branch}_${metric}_2026_${type}`;
    const path = `branchData/${dataId}`;
    try {
      await setDoc(doc(db, 'branchData', dataId), {
        branch,
        metric,
        year: 2026,
        type,
        values,
        updatedAt: Timestamp.now()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  const [editingCell, setEditingCell] = useState<{metric: string, type: string, index: number} | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');

  const handleInputChange = (metric: string, type: 'target' | 'actual' | 'prev', index: number, value: string) => {
    // Only allow numbers and one minus sign at start
    let cleanValue = value.replace(/[^0-9-]/g, '');
    if (cleanValue.indexOf('-') > 0) cleanValue = cleanValue.replace(/-/g, ''); // Remove incorrectly placed minus
    
    setEditingValue(cleanValue);
    
    if (cleanValue === '-' || cleanValue === '') {
      if (type === 'target') updateTarget(metric, selectedBranch, index, '0');
      else if (type === 'actual') updateActual2026(metric, selectedBranch, index, '0');
      else if (type === 'prev') updatePrevYear(metric, selectedBranch, index, '0');
      return;
    }

    const numValue = parseInt(cleanValue);
    if (!isNaN(numValue)) {
      if (type === 'target') updateTarget(metric, selectedBranch, index, cleanValue);
      else if (type === 'actual') updateActual2026(metric, selectedBranch, index, cleanValue);
      else if (type === 'prev') updatePrevYear(metric, selectedBranch, index, cleanValue);
    }
  };

  const getDisplayValue = (metric: string, type: 'target' | 'actual' | 'prev', index: number, storeValue: number) => {
    if (editingCell?.metric === metric && editingCell?.type === type && editingCell?.index === index) {
      return editingValue;
    }
    return formatCurrency(storeValue);
  };

  const updateTarget = (metric: string, branch: string, monthIndex: number, value: string) => {
    const cleanValue = value.replace(/[^0-9-]/g, '');
    let finalValue = 0;
    if (cleanValue !== '-' && cleanValue !== '') {
      finalValue = parseInt(cleanValue) || 0;
    }
    
    const currentValues = [...(targets[metric]?.[branch] || (metricConfig[metric] ? new Array(12).fill(0) : []))];
    currentValues[monthIndex] = finalValue;

    const newTargets = {
      ...targets,
      [metric]: {
        ...(targets[metric] || {}),
        [branch]: currentValues
      }
    };
    setTargets(newTargets);
    saveToFirestore(metric, branch, 'target', currentValues);
  };

  const updatePrevYear = (metric: string, branch: string, monthIndex: number, value: string) => {
    const cleanValue = value.replace(/[^0-9-]/g, '');
    let finalValue = 0;
    if (cleanValue !== '-' && cleanValue !== '') {
      finalValue = parseInt(cleanValue) || 0;
    }

    const currentValues = [...(prevYearData[metric]?.[branch] || new Array(12).fill(0))];
    currentValues[monthIndex] = finalValue;

    const newPrevYear = {
      ...prevYearData,
      [metric]: {
        ...(prevYearData[metric] || {}),
        [branch]: currentValues
      }
    };
    setPrevYearData(newPrevYear);
    saveToFirestore(metric, branch, 'prevYear', currentValues);
  };

  const updateActual2026 = (metric: string, branch: string, monthIndex: number, value: string) => {
    const cleanValue = value.replace(/[^0-9-]/g, '');
    let finalValue = 0;
    if (cleanValue !== '-' && cleanValue !== '') {
      finalValue = parseInt(cleanValue) || 0;
    }

    const currentValues = [...(actual2026Data[metric]?.[branch] || (metricConfig[metric] ? new Array(12).fill(0) : []))];
    currentValues[monthIndex] = finalValue;

    const newActual = {
      ...actual2026Data,
      [metric]: {
        ...(actual2026Data[metric] || {}),
        [branch]: currentValues
      }
    };
    setActual2026Data(newActual);
    saveToFirestore(metric, branch, 'actual', currentValues);
  };

  const updateTargetTotal = (metric: string, branch: string, value: string) => {
    const cleanValue = value.replace(/[^0-9-]/g, '');
    const numValue = parseInt(cleanValue) || 0;
    const isAverage = metric === 'atp' || metric === 'cpp' || metricConfig[metric]?.unit === '%';
    const monthlyValue = isAverage ? numValue : Math.round(numValue / 12);
    const newMonthlyData = new Array(12).fill(monthlyValue);
    
    const newTargets = {
      ...targets,
      [metric]: {
        ...(targets[metric] || {}),
        [branch]: newMonthlyData
      }
    };
    setTargets(newTargets);
    saveToFirestore(metric, branch, 'target', newMonthlyData);
  };

  const updateActualTotal = (metric: string, branch: string, value: string) => {
    const cleanValue = value.replace(/[^0-9-]/g, '');
    const numValue = parseInt(cleanValue) || 0;
    const isAverage = metric === 'atp' || metric === 'cpp' || metricConfig[metric]?.unit === '%';
    const monthlyValue = isAverage ? numValue : Math.round(numValue / 12);
    const newMonthlyData = new Array(12).fill(monthlyValue);

    const newActual = {
      ...actual2026Data,
      [metric]: {
        ...(actual2026Data[metric] || {}),
        [branch]: newMonthlyData
      }
    };
    setActual2026Data(newActual);
    saveToFirestore(metric, branch, 'actual', newMonthlyData);
  };

  const updatePrevYearTotal = (metric: string, branch: string, value: string) => {
    const cleanValue = value.replace(/[^0-9-]/g, '');
    const numValue = parseInt(cleanValue) || 0;
    const isAverage = metric === 'atp' || metric === 'cpp' || metricConfig[metric]?.unit === '%';
    const monthlyValue = isAverage ? numValue : Math.round(numValue / 12);
    const newMonthlyData = new Array(12).fill(monthlyValue);

    const newPrevYear = {
      ...prevYearData,
      [metric]: {
        ...(prevYearData[metric] || {}),
        [branch]: newMonthlyData
      }
    };
    setPrevYearData(newPrevYear);
    saveToFirestore(metric, branch, 'prevYear', newMonthlyData);
  };

  const resetMetric = (metric: string) => {
    const zeroValues = new Array(12).fill(0);

    // Reset targets
    const newTargets = {
      ...targets,
      [metric]: {
        ...(targets[metric] || {}),
        [selectedBranch]: zeroValues
      }
    };
    setTargets(newTargets);
    saveToFirestore(metric, selectedBranch, 'target', zeroValues);

    // Reset prev year
    const newPrevYear = {
      ...prevYearData,
      [metric]: {
        ...(prevYearData[metric] || {}),
        [selectedBranch]: zeroValues
      }
    };
    setPrevYearData(newPrevYear);
    saveToFirestore(metric, selectedBranch, 'prevYear', zeroValues);

    // Reset actual 2026
    const newActual = {
      ...actual2026Data,
      [metric]: {
        ...(actual2026Data[metric] || {}),
        [selectedBranch]: zeroValues
      }
    };
    setActual2026Data(newActual);
    saveToFirestore(metric, selectedBranch, 'actual', zeroValues);

    setResetConfirmMetric(null);
  };

  const addMetric = async () => {
    if (!newMetricLabel || !newMetricUnit) return;

    const metricKey = `custom_${Date.now()}`;
    const newConfig = {
      ...metricConfig,
      [metricKey]: {
        label: newMetricLabel,
        unit: newMetricUnit,
        color: '#' + Math.floor(Math.random()*16777215).toString(16),
        description: `${newMetricLabel} 지표`
      }
    };

    try {
      await setDoc(doc(db, 'appConfig', 'metrics'), { metrics: newConfig });
      setMetricConfig(newConfig);
      setIsAddMetricModalOpen(false);
      setNewMetricLabel('');
      setNewMetricUnit('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'appConfig/metrics');
    }
  };

  const deleteMetric = async (metricKey: string) => {
    const newConfig = { ...metricConfig };
    delete newConfig[metricKey];

    try {
      await setDoc(doc(db, 'appConfig', 'metrics'), { metrics: newConfig });
      setMetricConfig(newConfig);
      setDeleteConfirmMetric(null);
      if (selectedMetric === metricKey) {
        setSelectedMetric('visitors');
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'appConfig/metrics');
    }
  };

  // Use persisted 2026 actual data, fallback to 0 if not set
  const currentBranchActual = useMemo(() => {
    const data: Record<string, number[]> = {} as any;
    getSortedMetricKeys(metricConfig).forEach(metric => {
      data[metric] = actual2026Data[metric]?.[selectedBranch] || new Array(12).fill(0);
    });
    return data;
  }, [actual2026Data, selectedBranch, metricConfig]);

  const currentBranchTarget = targets;
  const currentBranchPrevYear = prevYearData;

  // Calculations for Dashboard
  const monthActual = currentBranchActual?.[selectedMetric]?.[selectedMonth] || 0;
  const monthTarget = currentBranchTarget?.[selectedMetric]?.[selectedBranch]?.[selectedMonth] || 1; // Avoid div by zero
  const monthPrevYear = currentBranchPrevYear?.[selectedMetric]?.[selectedBranch]?.[selectedMonth] || 1;

  const monthAchievementVsTarget = (monthActual / monthTarget) * 100;
  const monthAchievementVsPrevYear = (monthActual / monthPrevYear) * 100;

  // YTD Calculations
  const ytdActual = currentBranchActual?.[selectedMetric]?.slice(0, selectedMonth + 1).reduce((a, b) => a + b, 0) || 0;
  const ytdTarget = currentBranchTarget?.[selectedMetric]?.[selectedBranch]?.slice(0, selectedMonth + 1).reduce((a, b) => a + b, 0) || 1;
  const ytdPrevYear = currentBranchPrevYear?.[selectedMetric]?.[selectedBranch]?.slice(0, selectedMonth + 1).reduce((a, b) => a + b, 0) || 1;

  const ytdAchievementVsTarget = (ytdActual / ytdTarget) * 100;
  const ytdAchievementVsPrevYear = (ytdActual / ytdPrevYear) * 100;

  const chartData = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => ({
      month: `${i + 1}월`,
      실적: currentBranchActual?.[selectedMetric]?.[i] || 0,
      목표: currentBranchTarget?.[selectedMetric]?.[selectedBranch]?.[i] || 0,
      전년: currentBranchPrevYear?.[selectedMetric]?.[selectedBranch]?.[i] || 0,
    }));
  }, [selectedBranch, selectedMetric, currentBranchActual, currentBranchTarget, currentBranchPrevYear]);

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-8 rounded-[2rem] shadow-2xl w-full max-w-md border border-slate-100"
        >
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Lock size={32} />
            </div>
            <h2 className="text-2xl font-bold text-slate-900">시스템 로그인</h2>
            <p className="text-slate-500 text-sm mt-2">이름과 사번을 입력하여 접속하세요.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5 ml-1">이름</label>
              <input 
                type="text" 
                required
                value={loginName}
                onChange={(e) => setLoginName(e.target.value)}
                placeholder="홍길동"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5 ml-1">사번</label>
              <input 
                type="password" 
                required
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                placeholder="사번 입력"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all"
              />
            </div>
            
            {loginError && (
              <p className="text-rose-500 text-xs font-bold text-center">{loginError}</p>
            )}

            <button 
              type="submit"
              className="w-full py-4 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 mt-4"
            >
              로그인
            </button>
          </form>
          
          <div className="mt-8 pt-6 border-t border-slate-50 text-center">
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
              본 실적은 대외비 입니다.
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans">
      {/* Mobile Header */}
      <div className="lg:hidden flex items-center justify-between p-4 bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <span className="font-bold text-lg tracking-tight">Cinema2026</span>
        </div>
        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="p-2 hover:bg-slate-100 rounded-lg"
        >
          {isSidebarOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <aside className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-slate-200 transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-0",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}>
          <div className="h-full flex flex-col">
            <div className="p-6 hidden lg:block">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <h1 className="text-xl font-black text-slate-900 tracking-tighter">Cinema2026</h1>
                </div>
                
                {/* Desktop Sync Indicator */}
                <div className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-full transition-all border",
                  isSynced ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-rose-50 text-rose-600 border-rose-100"
                )} title={isSynced ? "Synced" : "Offline"}>
                  {isSynced ? <Wifi size={16} className="animate-pulse" /> : <WifiOff size={16} />}
                </div>
              </div>
            </div>

            <nav className="flex-1 px-4 space-y-8">
              <div>
                <p className="px-2 mb-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">지점 선택</p>
                <div className="space-y-1">
                  {BRANCHES.map((branch) => (
                    <button
                      key={branch}
                      onClick={() => {
                        setSelectedBranch(branch);
                        setIsSidebarOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
                        selectedBranch === branch 
                          ? "bg-blue-50 text-blue-600" 
                          : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                      )}
                    >
                      {branch}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="px-2 mb-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">메뉴</p>
                <div className="space-y-1">
                  <button 
                    onClick={() => setActiveView('dashboard')}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
                      activeView === 'dashboard' 
                        ? "bg-slate-900 text-white shadow-md" 
                        : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                    )}
                  >
                    <LayoutDashboard size={18} />
                    실적 대시보드
                  </button>
                  <button 
                    onClick={() => setActiveView('targets')}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
                      activeView === 'targets' 
                        ? "bg-slate-900 text-white shadow-md" 
                        : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                    )}
                  >
                    <Settings size={18} />
                    목표 설정 및 관리
                  </button>
                  <button 
                    onClick={() => setActiveView('admin')}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
                      activeView === 'admin' 
                        ? "bg-slate-900 text-white shadow-md" 
                        : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                    )}
                  >
                    <ShieldCheck size={18} />
                    열람등록 관리자
                  </button>
                </div>
              </div>
            </nav>

            <div className="p-4 border-t border-slate-100">
              <button 
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-rose-500 hover:bg-rose-50 transition-all"
              >
                <LogOut size={18} />
                로그아웃
              </button>
            </div>

          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-4 lg:p-8 max-w-[1600px] mx-auto w-full">
          {activeView === 'dashboard' && (
            <>
              {/* Dashboard Header */}
              <header className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-blue-600 font-bold text-sm mb-1">
                    {selectedBranch}
                  </div>
                  <h2 className="text-3xl font-bold text-slate-900 tracking-tight">2026 실적 현황</h2>
                  <p className="text-slate-500 mt-1">실시간 목표 및 전년 대비 실적 데이터를 확인하세요.</p>
                </div>
                
                <div className="flex items-center gap-3 bg-white p-1.5 rounded-2xl border border-slate-200 shadow-sm overflow-x-auto max-w-full">
                  {Array.from({ length: 12 }, (_, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedMonth(i)}
                      className={cn(
                        "px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap",
                        selectedMonth === i ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"
                      )}
                    >
                      {i + 1}월
                    </button>
                  ))}
                </div>
              </header>

              {/* Comparison Metrics Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4 mb-8">
                <ComparisonCard 
                  label="해당년도 누계 달성률 (YTD)" 
                  value={ytdAchievementVsTarget} 
                  type="percentage"
                  subValue={`1~${selectedMonth + 1}월`}
                  actual={ytdActual}
                  target={ytdTarget}
                  unit={metricConfig[selectedMetric]?.unit}
                />
                <ComparisonCard 
                  label="전년대비 누계 달성률 (YTD)" 
                  value={ytdAchievementVsPrevYear} 
                  type="percentage"
                  subValue={`1~${selectedMonth + 1}월`}
                  actual={ytdActual}
                  target={ytdPrevYear}
                  unit={metricConfig[selectedMetric]?.unit}
                />
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
                {getSortedMetricKeys(metricConfig).map((key) => {
                  const config = metricConfig[key];
                  const actual = currentBranchActual[key][selectedMonth];
                  const target = currentBranchTarget[key]?.[selectedBranch]?.[selectedMonth] || 1;
                  const prev = currentBranchPrevYear[key]?.[selectedBranch]?.[selectedMonth] || 1;
                  
                  return (
                    <div
                      key={key}
                      onClick={() => setSelectedMetric(key)}
                      className={cn(
                        "relative overflow-hidden cursor-pointer p-4 rounded-2xl border transition-all duration-300",
                        selectedMetric === key 
                          ? "bg-white border-blue-500 shadow-lg shadow-blue-100" 
                          : "bg-white/50 border-slate-200 hover:border-slate-300 hover:bg-white"
                      )}
                    >
                      <div className="flex flex-row justify-end gap-1 mb-3 whitespace-nowrap">
                          <div className={cn(
                            "text-[8px] sm:text-[9px] font-bold px-1.5 py-0.5 rounded-lg flex items-center gap-0.5",
                            (actual / target) >= 1 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
                          )}>
                            <span>목표 {((actual / target) * 100).toFixed(1)}%</span>
                            {(key === 'atp' || key === 'cpp') && (
                              <span className="text-[7px] sm:text-[8px] opacity-80 font-medium">
                                ({(actual - target) >= 0 ? '+' : ''}{formatCurrency(actual - target)}원)
                              </span>
                            )}
                          </div>
                          <div className={cn(
                            "text-[8px] sm:text-[9px] font-bold px-1.5 py-0.5 rounded-lg flex items-center gap-0.5",
                            (actual / prev) >= 1 ? "bg-blue-50 text-blue-600" : "bg-slate-100 text-slate-500"
                          )}>
                            <span>전년 {((actual / prev) * 100).toFixed(1)}%</span>
                            {(key === 'atp' || key === 'cpp') && (
                              <span className="text-[7px] sm:text-[8px] opacity-80 font-medium">
                                ({(actual - prev) >= 0 ? '+' : ''}{formatCurrency(actual - prev)}원)
                              </span>
                            )}
                          </div>
                      </div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">{config.label}</p>
                      <h3 className="text-sm font-bold text-slate-900 truncate">
                        {formatValue(actual, config.unit)}
                      </h3>
                    </div>
                  );
                })}
              </div>

              {/* Chart Section */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 items-stretch">
                <div className="xl:col-span-2 bg-white p-6 lg:p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">연간 추이 분석</h3>
                      <p className="text-sm text-slate-500">{metricConfig[selectedMetric]?.label} 지표 상세 현황</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-blue-500" />
                        <span className="text-xs font-medium text-slate-600">실적</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-slate-200" />
                        <span className="text-xs font-medium text-slate-600">목표</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-amber-400" />
                        <span className="text-xs font-medium text-slate-600">전년</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 min-h-[240px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis 
                          dataKey="month" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fill: '#94a3b8', fontSize: 12 }}
                          dy={10}
                        />
                        <YAxis 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fill: '#94a3b8', fontSize: 12 }}
                          tickFormatter={(val) => val >= 1000000 ? `${(val/1000000).toFixed(0)}M` : val >= 1000 ? `${(val/1000).toFixed(0)}K` : val}
                        />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: '#fff', 
                            borderRadius: '16px', 
                            border: 'none', 
                            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' 
                          }}
                          formatter={(value: number) => [formatValue(value, metricConfig[selectedMetric]?.unit || ''), '']}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="실적" 
                          stroke="#3b82f6" 
                          strokeWidth={3}
                          fillOpacity={1} 
                          fill="url(#colorActual)" 
                        />
                        <Area 
                          type="monotone" 
                          dataKey="목표" 
                          stroke="#e2e8f0" 
                          strokeWidth={2}
                          strokeDasharray="5 5"
                          fill="transparent"
                        />
                        <Area 
                          type="monotone" 
                          dataKey="전년" 
                          stroke="#fbbf24" 
                          strokeWidth={2}
                          fill="transparent"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="flex flex-col">
                  {/* Achievement Gauge */}
                  <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col items-center text-center h-full justify-center">
                    <h3 className="text-lg font-bold text-slate-900 mb-6">{selectedMonth + 1}월 달성률</h3>
                    <div className="relative w-48 h-48 flex items-center justify-center">
                      <svg className="w-full h-full transform -rotate-90">
                        <circle
                          cx="96"
                          cy="96"
                          r="80"
                          stroke="#f1f5f9"
                          strokeWidth="12"
                          fill="transparent"
                        />
                        <motion.circle
                          cx="96"
                          cy="96"
                          r="80"
                          stroke={metricConfig[selectedMetric]?.color || '#3b82f6'}
                          strokeWidth="12"
                          fill="transparent"
                          strokeDasharray={502.4}
                          initial={{ strokeDashoffset: 502.4 }}
                          animate={{ strokeDashoffset: 502.4 - (502.4 * Math.min(monthAchievementVsTarget, 100)) / 100 }}
                          transition={{ duration: 1.5, ease: "easeOut" }}
                          strokeLinecap="round"
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-4xl font-black text-slate-900">{monthAchievementVsTarget.toFixed(1)}%</span>
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Monthly</span>
                      </div>
                    </div>
                    <div className="mt-8 grid grid-cols-2 gap-8 w-full">
                      <div>
                        <p className="text-xs font-bold text-slate-400 uppercase mb-1">실적</p>
                        <p className="text-sm font-bold text-slate-900">{formatValue(monthActual, metricConfig[selectedMetric]?.unit || '')}</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-400 uppercase mb-1">목표</p>
                        <p className="text-sm font-bold text-slate-900">{formatValue(monthTarget, metricConfig[selectedMetric]?.unit || '')}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {activeView === 'targets' && (
            <div className="max-w-6xl mx-auto">
              {/* Targets View Header */}
              <header className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-blue-600 font-bold text-sm mb-1">
                    목표 및 전년 실적 관리
                  </div>
                  <h2 className="text-3xl font-bold text-slate-900 tracking-tight">{selectedBranch} 목표 데이터</h2>
                  <p className="text-slate-500 mt-1">2026년 목표치와 2025년 실적 데이터를 관리합니다.</p>
                </div>
                <button 
                  onClick={() => setIsAddMetricModalOpen(true)}
                  className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
                >
                  <Plus size={20} />
                  항목 추가
                </button>
              </header>

              <div className="space-y-8">
                {getSortedMetricKeys(metricConfig).map((key) => {
                  const config = metricConfig[key];
                  const targetsData = currentBranchTarget[key]?.[selectedBranch];
                  const prevYear = currentBranchPrevYear[key]?.[selectedBranch];

                  return (
                    <div key={key} className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                      <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <h3 className="text-lg font-bold text-slate-900">{config.label} ({config.unit})</h3>
                          <button 
                            onClick={() => setDeleteConfirmMetric(key)}
                            className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                            title="항목 삭제"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <button 
                          onClick={() => setResetConfirmMetric(key)}
                          className="px-3 py-1.5 text-[10px] font-bold text-rose-500 hover:bg-rose-50 rounded-lg transition-all flex items-center gap-1.5"
                        >
                          항목 초기화
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[1000px]">
                          <thead>
                            <tr className="bg-slate-50">
                              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest sticky left-0 bg-slate-50 z-10 w-32">구분</th>
                              {Array.from({ length: 12 }, (_, i) => (
                                <th key={i} className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">{i + 1}월</th>
                              ))}
                              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right bg-slate-100 w-48">
                                {key === 'atp' || key === 'cpp' || config.unit === '%' ? '평균' : '합계'}
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            <tr>
                              <td className="px-4 py-4 text-xs font-bold text-blue-600 sticky left-0 bg-white z-10">
                                2026 목표
                              </td>
                              {(targetsData || new Array(12).fill(0)).map((val: number, i: number) => (
                                <td key={i} className="px-2 py-2">
                                  <input 
                                    type="text"
                                    value={getDisplayValue(key, 'target', i, val)}
                                    onFocus={() => {
                                      setEditingCell({metric: key, type: 'target', index: i});
                                      setEditingValue(val === 0 ? '' : val.toString());
                                    }}
                                    onBlur={() => setEditingCell(null)}
                                    onChange={(e) => handleInputChange(key, 'target', i, e.target.value)}
                                    className="w-full px-2 py-1.5 text-xs text-right border border-transparent hover:border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-lg outline-none transition-all font-medium text-slate-600"
                                  />
                                </td>
                              ))}
                              <td className="px-4 py-4 text-xs font-bold text-slate-900 text-right bg-slate-50">
                                <input 
                                  type="text"
                                  value={(() => {
                                    const vals = targetsData || new Array(12).fill(0);
                                    const sum = vals.reduce((a: number, b: number) => a + b, 0);
                                    if (key === 'atp' || key === 'cpp' || config.unit === '%') {
                                      const count = vals.filter(v => v !== 0).length || 1;
                                      return formatCurrency(Math.round(sum / count));
                                    }
                                    return formatCurrency(sum);
                                  })()}
                                  onChange={(e) => updateTargetTotal(key, selectedBranch, e.target.value)}
                                  className="w-full px-2 py-1.5 text-xs text-right border border-transparent hover:border-slate-300 focus:border-blue-500 rounded-lg outline-none transition-all font-bold bg-transparent"
                                />
                              </td>
                            </tr>
                            <tr>
                              <td className="px-4 py-4 text-xs font-bold text-emerald-600 sticky left-0 bg-white z-10">
                                2026 실적
                              </td>
                              {(actual2026Data[key]?.[selectedBranch] || new Array(12).fill(0)).map((val: number, i: number) => (
                                <td key={i} className="px-2 py-2">
                                  <input 
                                    type="text"
                                    value={getDisplayValue(key, 'actual', i, val)}
                                    onFocus={() => {
                                      setEditingCell({metric: key, type: 'actual', index: i});
                                      setEditingValue(val === 0 ? '' : val.toString());
                                    }}
                                    onBlur={() => setEditingCell(null)}
                                    onChange={(e) => handleInputChange(key, 'actual', i, e.target.value)}
                                    className="w-full px-2 py-1.5 text-xs text-right border border-transparent hover:border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 rounded-lg outline-none transition-all font-medium text-slate-600"
                                  />
                                </td>
                              ))}
                              <td className="px-4 py-4 text-xs font-bold text-slate-900 text-right bg-slate-50">
                                <input 
                                  type="text"
                                  value={(() => {
                                    const actuals = actual2026Data[key]?.[selectedBranch] || new Array(12).fill(0);
                                    const sum = actuals.reduce((a: number, b: number) => a + b, 0);
                                    if (sum === 0) return '0';
                                    
                                    if (key === 'atp' || key === 'cpp' || config.unit === '%') {
                                      const count = actuals.filter(v => v !== 0).length || 1;
                                      return formatCurrency(Math.round(sum / count));
                                    }
                                    return formatCurrency(sum);
                                  })()}
                                  onChange={(e) => updateActualTotal(key, selectedBranch, e.target.value)}
                                  className="w-full px-2 py-1.5 text-xs text-right border border-transparent hover:border-slate-300 focus:border-emerald-500 rounded-lg outline-none transition-all font-bold bg-transparent"
                                />
                              </td>
                            </tr>
                            <tr>
                              <td className="px-4 py-4 text-xs font-bold text-amber-600 sticky left-0 bg-white z-10">
                                2025 실적
                              </td>
                              {(prevYear || new Array(12).fill(0)).map((val: number, i: number) => (
                                <td key={i} className="px-2 py-2">
                                  <input 
                                    type="text"
                                    value={getDisplayValue(key, 'prev', i, val)}
                                    onFocus={() => {
                                      setEditingCell({metric: key, type: 'prev', index: i});
                                      setEditingValue(val === 0 ? '' : val.toString());
                                    }}
                                    onBlur={() => setEditingCell(null)}
                                    onChange={(e) => handleInputChange(key, 'prev', i, e.target.value)}
                                    className="w-full px-2 py-1.5 text-xs text-right border border-transparent hover:border-slate-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-100 rounded-lg outline-none transition-all text-slate-600"
                                  />
                                </td>
                              ))}
                              <td className="px-4 py-4 text-xs font-bold text-slate-900 text-right bg-slate-50">
                                <input 
                                  type="text"
                                  value={(() => {
                                    const currentPrevYear = prevYear || new Array(12).fill(0);
                                    const sum = currentPrevYear.reduce((a: number, b: number) => a + b, 0);
                                    if (key === 'atp' || key === 'cpp' || config.unit === '%') {
                                      const count = currentPrevYear.filter(v => v !== 0).length || 1;
                                      return formatCurrency(Math.round(sum / count));
                                    }
                                    return formatCurrency(sum);
                                  })()}
                                  onChange={(e) => updatePrevYearTotal(key, selectedBranch, e.target.value)}
                                  className="w-full px-2 py-1.5 text-xs text-right border border-transparent hover:border-slate-300 focus:border-amber-500 rounded-lg outline-none transition-all font-bold bg-transparent"
                                />
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeView === 'admin' && (
            <div className="max-w-4xl mx-auto">
              <header className="mb-8">
                <div className="flex items-center gap-2 text-blue-600 font-bold text-sm mb-1">
                  시스템 설정
                </div>
                <h2 className="text-3xl font-bold text-slate-900 tracking-tight">열람등록 관리자</h2>
                <p className="text-slate-500 mt-1">시스템에 접속 가능한 관리자 계정을 관리합니다.</p>
              </header>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="md:col-span-1">
                  <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm sticky top-8">
                    <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                      <UserPlus size={20} className="text-blue-600" />
                      신규 등록
                    </h3>
                    <form onSubmit={registerAdmin} className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5 ml-1">이름</label>
                        <input 
                          type="text" 
                          required
                          value={newAdminName}
                          onChange={(e) => setNewAdminName(e.target.value)}
                          placeholder="이름 입력"
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5 ml-1">사번</label>
                        <input 
                          type="text" 
                          required
                          value={newAdminId}
                          onChange={(e) => setNewAdminId(e.target.value)}
                          placeholder="사번 입력"
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all text-sm"
                        />
                      </div>
                      <button 
                        type="submit"
                        className="w-full py-3 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-800 transition-all shadow-lg shadow-slate-200"
                      >
                        등록하기
                      </button>
                    </form>
                  </div>
                </div>

                <div className="md:col-span-2">
                  <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                      <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                        <ShieldCheck size={20} className="text-emerald-500" />
                        등록된 관리자 목록
                      </h3>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {admins.map((admin) => (
                        <div key={admin.employeeId} className="p-6 flex items-center justify-between hover:bg-slate-50 transition-all">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-slate-600 font-bold">
                              {admin.name[0]}
                            </div>
                            <div>
                              <p className="font-bold text-slate-900">{admin.name}</p>
                              <p className="text-xs text-slate-500">사번: {admin.employeeId}</p>
                            </div>
                          </div>
                          <button 
                            onClick={() => deleteAdmin(admin.employeeId)}
                            className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                            title="삭제"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      ))}
                      {admins.length === 0 && (
                        <div className="p-12 text-center">
                          <p className="text-slate-400 text-sm">등록된 관리자가 없습니다.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Quick Entry Modal */}
      <AnimatePresence>
        {editingMetric && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div>
                    <h3 className="font-bold text-slate-900">{METRIC_CONFIG[editingMetric].label} 데이터 입력</h3>
                    <p className="text-xs text-slate-500">{selectedBranch} • {selectedMonth + 1}월</p>
                  </div>
                </div>
                <button 
                  onClick={() => setEditingMetric(null)}
                  className="p-2 hover:bg-white rounded-xl text-slate-400 hover:text-slate-900 transition-all"
                >
                  <X size={20} />
                </button>
              </div>
              
              <div className="p-6 space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">2026 목표 ({metricConfig[editingMetric]?.unit || ''})</label>
                  <div className="relative">
                    <input 
                      type="text"
                      autoFocus
                      value={getDisplayValue(editingMetric, 'target', selectedMonth, targets[editingMetric]?.[selectedBranch]?.[selectedMonth] || 0)}
                      onFocus={() => {
                        const val = targets[editingMetric]?.[selectedBranch]?.[selectedMonth] || 0;
                        setEditingCell({metric: editingMetric, type: 'target', index: selectedMonth});
                        setEditingValue(val === 0 ? '' : val.toString());
                      }}
                      onBlur={() => setEditingCell(null)}
                      onChange={(e) => handleInputChange(editingMetric, 'target', selectedMonth, e.target.value)}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 rounded-2xl outline-none transition-all font-bold text-lg text-slate-900"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">2026 실적 ({metricConfig[editingMetric]?.unit || ''})</label>
                  <div className="relative">
                    <input 
                      type="text"
                      value={getDisplayValue(editingMetric, 'actual', selectedMonth, actual2026Data[editingMetric]?.[selectedBranch]?.[selectedMonth] || 0)}
                      onFocus={() => {
                        const val = actual2026Data[editingMetric]?.[selectedBranch]?.[selectedMonth] || 0;
                        setEditingCell({metric: editingMetric, type: 'actual', index: selectedMonth});
                        setEditingValue(val === 0 ? '' : val.toString());
                      }}
                      onBlur={() => setEditingCell(null)}
                      onChange={(e) => handleInputChange(editingMetric, 'actual', selectedMonth, e.target.value)}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 rounded-2xl outline-none transition-all font-bold text-lg text-slate-900"
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <button 
                    onClick={() => setEditingMetric(null)}
                    className="w-full py-4 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-800 transition-all shadow-lg shadow-slate-200"
                  >
                    저장 및 닫기
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Reset Confirmation Modal */}
      <AnimatePresence>
        {resetConfirmMetric && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-8 text-center">
                <h3 className="text-xl font-bold text-slate-900 mb-2">데이터 초기화</h3>
                <p className="text-slate-500 text-sm leading-relaxed">
                  <span className="font-bold text-slate-900">[{metricConfig[resetConfirmMetric]?.label}]</span> 항목의 {selectedBranch} 데이터를 초기화하시겠습니까?<br/>
                  이 작업은 되돌릴 수 없습니다.
                </p>
              </div>
              <div className="p-4 bg-slate-50 flex gap-3">
                <button 
                  onClick={() => setResetConfirmMetric(null)}
                  className="flex-1 py-3 bg-white border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-100 transition-all"
                >
                  취소
                </button>
                <button 
                  onClick={() => resetMetric(resetConfirmMetric)}
                  className="flex-1 py-3 bg-rose-500 text-white font-bold rounded-xl hover:bg-rose-600 transition-all shadow-lg shadow-rose-200"
                >
                  초기화 실행
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Metric Modal */}
      <AnimatePresence>
        {isAddMetricModalOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-slate-900">새로운 항목 추가</h3>
                <button onClick={() => setIsAddMetricModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full">
                  <X size={20} />
                </button>
              </div>
              
              <div className="space-y-4 mb-8">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5 ml-1">항목 제목</label>
                  <input 
                    type="text" 
                    placeholder="예: 기타매출, 소모품비 등"
                    value={newMetricLabel}
                    onChange={(e) => setNewMetricLabel(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5 ml-1">단위</label>
                  <input 
                    type="text" 
                    placeholder="예: 원, 명, 건, % 등"
                    value={newMetricUnit}
                    onChange={(e) => setNewMetricUnit(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setIsAddMetricModalOpen(false)}
                  className="flex-1 px-4 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-all"
                >
                  취소
                </button>
                <button 
                  onClick={addMetric}
                  disabled={!newMetricLabel || !newMetricUnit}
                  className="flex-1 px-4 py-3 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-200"
                >
                  추가하기
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deleteConfirmMetric && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Trash2 size={32} />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">항목 삭제</h3>
                <p className="text-slate-500 text-sm leading-relaxed">
                  <span className="font-bold text-slate-900">[{metricConfig[deleteConfirmMetric]?.label}]</span> 항목을 완전히 삭제하시겠습니까?<br/>
                  이 항목과 관련된 모든 데이터가 영구적으로 삭제됩니다.
                </p>
              </div>
              <div className="p-4 bg-slate-50 flex gap-3">
                <button 
                  onClick={() => setDeleteConfirmMetric(null)}
                  className="flex-1 py-3 bg-white border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-100 transition-all"
                >
                  취소
                </button>
                <button 
                  onClick={() => deleteMetric(deleteConfirmMetric)}
                  className="flex-1 py-3 bg-rose-500 text-white font-bold rounded-xl hover:bg-rose-600 transition-all shadow-lg shadow-rose-200"
                >
                  삭제 실행
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
