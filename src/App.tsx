import React, { useState, useEffect, createContext, useContext, useRef } from 'react';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  getAuth,
  User,
  sendEmailVerification,
  sendPasswordResetEmail
} from 'firebase/auth';
import { initializeApp, deleteApp } from 'firebase/app';
import firebaseConfig from '../firebase-applet-config.json';
import { 
  doc, 
  getDoc, 
  getDocs,
  setDoc, 
  collection, 
  query, 
  where, 
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  orderBy,
  limit,
  Timestamp,
  serverTimestamp,
  getFirestore
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, uploadString } from 'firebase/storage';
import { auth, db, storage } from './firebase';
import { UserProfile, Store, Product, Sale, UserRole, AttendanceRecord } from './types';
import { 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  Users, 
  LogOut, 
  Plus, 
  Search, 
  Trash2, 
  Edit, 
  ChevronRight,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Box,
  Store as StoreIcon,
  AlertCircle,
  CheckCircle2,
  X,
  Eye,
  EyeOff,
  UserCircle,
  Settings,
  Moon,
  Sun,
  User as UserIcon,
  Shield,
  Palette,
  Camera,
  Upload,
  ChevronDown,
  ArrowLeft,
  ClipboardCheck,
  MessageSquare,
  UserX,
  Calendar
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line,
  AreaChart,
  Area,
  Legend,
  Cell
} from 'recharts';
import * as d3 from 'd3';
import { sankey, sankeyLinkHorizontal } from 'd3-sankey';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, parseISO, subDays, isAfter } from 'date-fns';
import { es } from 'date-fns/locale';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Finanzas } from './components/Finanzas';

// --- Utils ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const requestNotificationPermission = async () => {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission !== "denied") {
    const permission = await Notification.requestPermission();
    return permission === "granted";
  }
  return false;
};

const triggerSystemNotification = (title: string, body: string, icon?: string) => {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    try {
      new Notification(title, {
        body,
        icon: icon || '/pwa-192x192.svg',
        vibrate: [200, 100, 200]
      } as any);
    } catch (e) {
      // In some mobile browsers, new Notification() might fail if not in a service worker
      // but we try our best.
      console.error("Error showing notification:", e);
    }
  }
};

const compressImage = (fileOrDataUrl: File | string, maxWidth = 800, maxHeight = 800, quality = 0.72): Promise<string> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    
    const processImage = (dataUrl: string) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        
        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedDataUrl);
      };
      img.onerror = () => {
        resolve(dataUrl);
      };
      img.src = dataUrl;
    };

    if (typeof fileOrDataUrl === 'string') {
      if (fileOrDataUrl.startsWith('data:')) {
        processImage(fileOrDataUrl);
      } else {
        fetch(fileOrDataUrl)
          .then(res => res.blob())
          .then(blob => {
            reader.onloadend = () => processImage(reader.result as string);
            reader.readAsDataURL(blob);
          })
          .catch(() => resolve(fileOrDataUrl));
      }
    } else {
      reader.onloadend = () => processImage(reader.result as string);
      reader.readAsDataURL(fileOrDataUrl);
    }
  });
};

export const uploadImage = async (fileOrDataUrl: File | string, path: string): Promise<string> => {
  const storageRef = ref(storage, path);
  
  // Compress the image before uploading to keep file sizes very low and make loading faster
  let compressedDataUrl: string;
  try {
    compressedDataUrl = await compressImage(fileOrDataUrl);
  } catch (err) {
    console.error("Error compressing image, uploading original instead", err);
    if (typeof fileOrDataUrl === 'string' && fileOrDataUrl.startsWith('data:')) {
      await uploadString(storageRef, fileOrDataUrl, 'data_url');
    } else if (typeof fileOrDataUrl === 'string') {
      const response = await fetch(fileOrDataUrl);
      const blob = await response.blob();
      await uploadBytes(storageRef, blob);
    } else {
      await uploadBytes(storageRef, fileOrDataUrl);
    }
    return getDownloadURL(storageRef);
  }

  await uploadString(storageRef, compressedDataUrl, 'data_url');
  return getDownloadURL(storageRef);
};

// --- Context ---
interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  store: Store | null;
  loading: boolean;
  error: string | null;
}

export const AuthContext = createContext<AuthContextType>({ 
  user: null, 
  profile: null, 
  store: null, 
  loading: true, 
  error: null
});

// --- Components ---

const NotificationListener = () => {
  const { store, user } = useContext(AuthContext);
  const lastProcessedId = React.useRef<string | null>(null);
  const mountTime = React.useRef(new Date().toISOString());

  useEffect(() => {
    // Request permission on mount
    requestNotificationPermission();
  }, []);

  useEffect(() => {
    if (!store || !user) return;

    // Listen to changes in attendance
    const q = query(
      collection(db, 'attendance'),
      where('storeId', '==', store.id),
      orderBy('timestamp', 'desc'),
      limit(1)
    );

    const unsub = onSnapshot(q, (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === "added") {
          const data = change.doc.data() as AttendanceRecord;
          const id = change.doc.id;
          
          // Only notify if it's new (added after mount) and not processed
          if (data.timestamp > mountTime.current && id !== lastProcessedId.current) {
            lastProcessedId.current = id;
            
            // Don't notify the person who just did it (optional, but requested for "everyone")
            // User said "all users", so we include everyone.
            
            const typeLabel = data.type === 'ingreso' ? 'Llegada' : 'Salida';
            triggerSystemNotification(
              `Asistencia: ${data.sellerName}`,
              `Marcó ${typeLabel} a las ${format(new Date(data.timestamp), 'HH:mm')}`
            );
          }
        }
      });
    });

    return () => unsub();
  }, [store, user]);

  return null;
};

const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' }>(
  ({ className, variant = 'primary', ...props }, ref) => {
    const buttonVariants = {
      primary: "bg-yellow-400 text-black hover:bg-yellow-500 shadow-sm",
      secondary: "bg-zinc-800 text-white hover:bg-zinc-700",
      outline: "border-zinc-800 text-zinc-400 hover:bg-zinc-900",
      ghost: "text-zinc-500 hover:text-white hover:bg-zinc-900",
      danger: "bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20"
    };

    return (
      <button
        ref={ref}
        className={cn("px-3 py-1.5 rounded-lg font-medium transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-1.5 text-xs", buttonVariants[variant], className)}
        {...props}
      />
    );
  }
);

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full rounded-lg px-3 py-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-yellow-400/50 bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-600 text-sm",
          className
        )}
        {...props}
      />
    );
  }
);

const Card = ({ children, className, ...props }: { children: React.ReactNode; className?: string; [key: string]: any }) => {
  return (
    <div 
      className={cn(
        "rounded-xl p-4 transition-all bg-zinc-900/50 border-zinc-800 shadow-none hover:shadow-yellow-400/5",
        className
      )} 
      {...props}
    >
      {children}
    </div>
  );
};

// --- Pages ---

const Dashboard = () => {
  const { store } = useContext(AuthContext);
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [filterRange, setFilterRange] = useState<'today' | '7d' | '30d'>('today');
  const [view, setView] = useState<'summary' | 'transactions' | 'lowStock' | 'performance'>(() => {
    const params = new URLSearchParams(window.location.search);
    const sub = params.get('sub');
    const valid = ['summary', 'transactions', 'lowStock', 'performance'];
    return (valid.includes(sub || '') ? sub : 'summary') as any;
  });

  const handleSubViewChange = (newView: typeof view) => {
    if (newView === view) return;
    setView(newView);
    const params = new URLSearchParams(window.location.search);
    params.set('sub', newView);
    window.history.pushState({ sub: newView }, '', `?${params.toString()}`);
  };

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const params = new URLSearchParams(window.location.search);
      const sub = params.get('sub') || 'summary';
      setView(sub as any);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!store) return;
    const qSales = query(collection(db, 'sales'), where('storeId', '==', store.id), orderBy('timestamp', 'desc'), limit(1000));
    const unsubSales = onSnapshot(qSales, (snap) => {
      setSales(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Sale)));
    });

    const qProducts = query(collection(db, 'products'), where('storeId', '==', store.id));
    const unsubProducts = onSnapshot(qProducts, (snap) => {
      setProducts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product)));
    });

    const qExpenses = query(collection(db, 'expenses'), where('storeId', '==', store.id), orderBy('createdAt', 'desc'), limit(1000));
    const unsubExpenses = onSnapshot(qExpenses, (snap) => {
      setExpenses(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
    });

    return () => { unsubSales(); unsubProducts(); unsubExpenses(); };
  }, [store]);

  const filteredSales = sales.filter(sale => {
    const saleDate = new Date(sale.timestamp);
    if (filterRange === 'today') {
      return isSameDay(saleDate, new Date());
    }
    const days = filterRange === '7d' ? 7 : 30;
    const cutoff = subDays(new Date(), days);
    return isAfter(saleDate, cutoff);
  });

  const filteredExpenses = expenses.filter(exp => {
    const expDate = new Date(exp.createdAt);
    if (filterRange === 'today') {
      return isSameDay(expDate, new Date());
    }
    const days = filterRange === '7d' ? 7 : 30;
    const cutoff = subDays(new Date(), days);
    return isAfter(expDate, cutoff);
  });

  const totalRevenue = filteredSales.reduce((sum, s) => sum + s.total, 0);
  const totalExpensesCount = filteredExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
  const lowStockProducts = products.filter(p => p.stock <= 2);
  const lowStockCount = lowStockProducts.length;

  const dailyData = {} as Record<string, { name: string; sales: number; expenses: number }>;
  
  // Fill with last N days based on range
  const daysToShow = filterRange === 'today' ? 1 : filterRange === '7d' ? 7 : 30;
  for (let i = 0; i < daysToShow; i++) {
    const d = subDays(new Date(), i);
    const dateKey = format(d, 'MMM dd');
    dailyData[dateKey] = { name: dateKey, sales: 0, expenses: 0 };
  }

  filteredSales.forEach(sale => {
    const date = format(new Date(sale.timestamp), 'MMM dd');
    if (dailyData[date]) dailyData[date].sales += sale.total;
  });

  filteredExpenses.forEach(exp => {
    const date = format(new Date(exp.createdAt), 'MMM dd');
    if (dailyData[date]) dailyData[date].expenses += (parseFloat(exp.amount) || 0);
  });

  const chartData = Object.values(dailyData).reverse();

  const sellerSales = filteredSales.reduce((acc, sale) => {
    const seller = sale.sellerName || 'Desconocido';
    acc[seller] = (acc[seller] || 0) + sale.total;
    return acc;
  }, {} as Record<string, number>);

  const sellerChartData = Object.entries(sellerSales)
    .map(([name, total]) => ({ name, total: total as number }))
    .sort((a, b) => b.total - a.total);

  // Sankey Data Generation
  const sankeyRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!sankeyRef.current || view !== 'summary') return;

    const width = 800;
    const height = 400;

    const svg = d3.select(sankeyRef.current)
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', '100%')
      .attr('height', '100%');

    svg.selectAll('*').remove();

    // Prepare Sankey Nodes and Links
    // Nodes: Venta (Total Income), Gasto (Total Expense), and categories if mapping exists
    // For now: [Ventas] -> [Flujo de Caja] -> [Gastos]
    const nodes: any[] = [
      { name: 'Ventas Totales' },
      { name: 'Flujo de Caja' },
      { name: 'Gastos / Egresos' },
      { name: 'Saldo Neto' }
    ];

    const links: any[] = [];

    if (totalRevenue > 0) {
      links.push({ source: 0, target: 1, value: totalRevenue });
    }
    
    if (totalExpensesCount > 0) {
      links.push({ source: 1, target: 2, value: totalExpensesCount });
    }

    const netValue = totalRevenue - totalExpensesCount;
    if (netValue > 0) {
      links.push({ source: 1, target: 3, value: netValue });
    }

    // Add extra categories from expenses if possible
    const expenseCategories = filteredExpenses.reduce((acc, exp) => {
      const item = exp.item ? (exp.item.length > 15 ? exp.item.slice(0, 15) + '...' : exp.item) : 'Otros';
      acc[item] = (acc[item] || 0) + (parseFloat(exp.amount) || 0);
      return acc;
    }, {} as Record<string, number>);

    let catIndex = 4;
    Object.entries(expenseCategories).forEach(([name, value]) => {
      nodes.push({ name });
      links.push({ source: 2, target: catIndex, value });
      catIndex++;
    });

    if (links.length === 0) return;

    const generator = sankey()
      .nodeWidth(15)
      .nodePadding(10)
      .extent([[1, 1], [width - 1, height - 6]]);

    const { nodes: skNodes, links: skLinks } = generator({
      nodes: nodes.map(d => Object.assign({}, d)),
      links: links.map(d => Object.assign({}, d))
    });

    const color = d3.scaleOrdinal(d3.schemeCategory10);

    svg.append('g')
      .selectAll('rect')
      .data(skNodes)
      .join('rect')
      .attr('x', (d: any) => d.x0)
      .attr('y', (d: any) => d.y0)
      .attr('height', (d: any) => d.y1 - d.y0)
      .attr('width', (d: any) => d.x1 - d.x0)
      .attr('fill', (d: any) => d.name === 'Saldo Neto' ? '#22c55e' : d.name === 'Gastos / Egresos' ? '#ef4444' : '#fbbf24')
      .attr('opacity', 0.8)
      .append('title')
      .text((d: any) => `${d.name}\nS/ ${d.value.toFixed(2)}`);

    svg.append('g')
      .attr('fill', 'none')
      .attr('stroke-opacity', 0.2)
      .selectAll('g')
      .data(skLinks)
      .join('path')
      .attr('d', sankeyLinkHorizontal())
      .attr('stroke', (d: any) => d.target.name === 'Saldo Neto' ? '#22c55e' : d.target.name.includes('...') || nodes.length > 4 && d.source.index === 2 ? '#ef4444' : '#fbbf24')
      .attr('stroke-width', (d: any) => Math.max(1, d.width))
      .append('title')
      .text((d: any) => `${d.source.name} → ${d.target.name}\nS/ ${d.value.toFixed(2)}`);

    svg.append('g')
      .style('font-size', '10px')
      .style('fill', 'white')
      .selectAll('text')
      .data(skNodes)
      .join('text')
      .attr('x', (d: any) => d.x0 < width / 2 ? d.x1 + 6 : d.x0 - 6)
      .attr('y', (d: any) => (d.y1 + d.y0) / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', (d: any) => d.x0 < width / 2 ? 'start' : 'end')
      .text((d: any) => d.name)
      .append('tspan')
      .attr('fill-opacity', 0.5)
      .attr('x', (d: any) => d.x0 < width / 2 ? d.x1 + 6 : d.x0 - 6)
      .attr('dy', '1.2em')
      .text((d: any) => `S/ ${d.value.toFixed(2)}`);

  }, [view, filterRange, totalRevenue, totalExpensesCount, filteredExpenses]);

  if (view !== 'summary') {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.2 }}
          className="space-y-6"
        >
          <button 
            onClick={() => handleSubViewChange('summary')}
            className="hidden md:flex items-center gap-2 text-zinc-500 hover:text-yellow-400 transition-colors mb-4"
          >
            <ArrowLeft size={20} /> Volver al Resumen
          </button>

        {view === 'transactions' && (
          <div className="space-y-4">
            <h3 className="text-xl font-bold text-white">Detalle de Transacciones</h3>
            <Card className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="pb-4 text-zinc-500 font-medium text-sm">Fecha</th>
                    <th className="pb-4 text-zinc-500 font-medium text-sm">Vendedor</th>
                    <th className="pb-4 text-zinc-500 font-medium text-sm">Productos</th>
                    <th className="pb-4 text-zinc-500 font-medium text-sm text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {filteredSales.map(sale => (
                    <tr key={sale.id}>
                      <td className="py-4 text-white text-sm">{format(new Date(sale.timestamp), 'dd/MM HH:mm')}</td>
                      <td className="py-4 text-zinc-400 text-sm">{sale.sellerName || 'N/A'}</td>
                      <td className="py-4 text-zinc-400 text-sm">
                        {sale.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
                      </td>
                      <td className="py-4 text-yellow-500 font-bold text-sm text-right">S/ {sale.total.toFixed(2)}</td>
                    </tr>
                  ))}
                  {filteredSales.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-zinc-500 italic">No hay transacciones en este periodo</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        {view === 'lowStock' && (
          <div className="space-y-4">
            <h3 className="text-xl font-bold text-white">Productos con stock bajo</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {lowStockProducts.map(p => (
                <Card key={p.id} className="flex items-center gap-4">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.name} className="w-12 h-12 rounded-lg object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-12 h-12 rounded-lg flex items-center justify-center text-[8px] bg-zinc-800 text-zinc-600">NO FOTO</div>
                  )}
                  <div className="flex-1">
                    <p className="font-bold text-sm text-white">{p.name}</p>
                    <p className="text-red-500 text-xs font-bold">Stock: {p.stock} unid.</p>
                  </div>
                </Card>
              ))}
              {lowStockProducts.length === 0 && (
                <div className="col-span-full py-8 text-center text-zinc-500 italic">No hay productos con stock crítico</div>
              )}
            </div>
          </div>
        )}

        {view === 'performance' && (
          <div className="space-y-8">
            <div className="space-y-4">
              <h3 className="text-xl font-bold text-white">Ventas vs Gastos por Fecha</h3>
              <Card className="h-[400px] flex flex-col">
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ left: 40, right: 20, top: 20, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={true} vertical={false} />
                      <XAxis dataKey="name" stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `S/${v}`} />
                      <Tooltip 
                        cursor={{ fill: '#27272a', opacity: 0.5 }}
                        contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                        itemStyle={{ color: '#FBBF24' }}
                        formatter={(value: any, name: string) => [`S/ ${value.toFixed(2)}`, name === 'sales' ? 'Ventas' : 'Gastos']}
                      />
                      <Legend verticalAlign="top" align="right" height={36} iconType="circle" />
                      <Bar dataKey="sales" name="Ventas" fill="#FBBF24" radius={[4, 4, 0, 0]} barSize={20} />
                      <Bar dataKey="expenses" name="Gastos" fill="#ef4444" radius={[4, 4, 0, 0]} barSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>

            <div className="space-y-4">
              <h3 className="text-xl font-bold text-white">Ranking de Ventas por Vendedor</h3>
              <Card className="h-[400px] flex flex-col">
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sellerChartData} layout="vertical" margin={{ left: 40, right: 20, top: 20, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} vertical={true} />
                      <XAxis type="number" stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `S/${v}`} />
                      <YAxis dataKey="name" type="category" stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} width={100} />
                      <Tooltip 
                        cursor={{ fill: '#27272a', opacity: 0.5 }}
                        contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                        itemStyle={{ color: '#FBBF24' }}
                        formatter={(value: any) => [`S/ ${value.toFixed(2)}`, 'Ventas']}
                      />
                      <Bar dataKey="total" fill="#FBBF24" radius={[0, 4, 4, 0]} barSize={20}>
                        {sellerChartData.map((entry, index) => (
                           <Cell key={`cell-${index}`} fill={d3.schemeCategory10[index % 10]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="summary"
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 10 }}
        transition={{ duration: 0.2 }}
        className="space-y-6"
      >
      <div className="flex flex-col sm:flex-row justify-end items-start sm:items-center gap-4">
        <div className="flex border border-zinc-800 p-1 rounded-xl w-full sm:w-auto overflow-x-auto bg-zinc-900">
          <button 
            onClick={() => setFilterRange('today')}
            className={cn(
              "flex-1 sm:flex-none px-4 py-2 text-[10px] sm:text-xs rounded-lg transition-all whitespace-nowrap", 
              filterRange === 'today' 
                ? "bg-yellow-400 text-black font-bold" 
                : "text-zinc-400 hover:text-white"
            )}
          >
            HOY
          </button>
          <button 
            onClick={() => setFilterRange('7d')}
            className={cn(
              "flex-1 sm:flex-none px-4 py-2 text-[10px] sm:text-xs rounded-lg transition-all whitespace-nowrap", 
              filterRange === '7d' 
                ? "bg-yellow-400 text-black font-bold" 
                : "text-zinc-400 hover:text-white"
            )}
          >
            SEMANA
          </button>
          <button 
            onClick={() => setFilterRange('30d')}
            className={cn(
              "flex-1 sm:flex-none px-4 py-2 text-[10px] sm:text-xs rounded-lg transition-all whitespace-nowrap", 
              filterRange === '30d' 
                ? "bg-yellow-400 text-black font-bold" 
                : "text-zinc-400 hover:text-white"
            )}
          >
            MES
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <button onClick={() => handleSubViewChange('performance')} className="text-left group outline-none">
          <Card className="flex items-center gap-4 group-hover:border-yellow-400/50 transition-all h-full cursor-pointer">
            <div className="p-3 bg-yellow-400/10 rounded-lg group-hover:bg-yellow-400/20 transition-colors">
              <DollarSign className="text-yellow-400" />
            </div>
            <div>
              <p className="text-zinc-400 text-xs uppercase tracking-widest font-medium">Ventas ({filterRange === 'today' ? 'Hoy' : filterRange === '7d' ? 'Semana' : 'Mes'})</p>
              <p className="text-lg font-bold text-white">S/ {totalRevenue.toFixed(2)}</p>
            </div>
          </Card>
        </button>

        <button onClick={() => handleSubViewChange('performance')} className="text-left group outline-none">
          <Card className="flex items-center gap-4 group-hover:border-red-500/50 transition-all h-full cursor-pointer">
            <div className="p-3 bg-red-500/10 rounded-lg group-hover:bg-red-500/20 transition-colors">
              <TrendingDown className="text-red-500" />
            </div>
            <div>
              <p className="text-zinc-400 text-xs uppercase tracking-widest font-medium">Gastos ({filterRange === 'today' ? 'Hoy' : filterRange === '7d' ? 'Semana' : 'Mes'})</p>
              <p className="text-lg font-bold text-white">S/ {totalExpensesCount.toFixed(2)}</p>
            </div>
          </Card>
        </button>

        <button onClick={() => handleSubViewChange('transactions')} className="text-left group outline-none">
          <Card className="flex items-center gap-4 group-hover:border-blue-400/50 transition-all h-full cursor-pointer">
            <div className="p-3 bg-blue-400/10 rounded-lg group-hover:bg-blue-400/20 transition-colors">
              <ShoppingCart className="text-blue-400" />
            </div>
            <div>
              <p className="text-zinc-400 text-xs uppercase tracking-widest font-medium">Transacciones</p>
              <p className="text-lg font-bold text-white">{filteredSales.length}</p>
            </div>
          </Card>
        </button>

        <button onClick={() => handleSubViewChange('lowStock')} className="text-left group outline-none">
          <Card className="flex items-center gap-4 group-hover:border-red-400/50 transition-all h-full cursor-pointer">
            <div className="p-3 bg-red-400/10 rounded-lg group-hover:bg-red-400/20 transition-colors">
              <Box className="text-red-400" />
            </div>
            <div>
              <p className="text-zinc-400 text-xs uppercase tracking-widest font-medium">Stock bajo</p>
              <p className="text-lg font-bold text-white">{lowStockCount}</p>
            </div>
          </Card>
        </button>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-[0.2em]">Diagrama de Flujo de Caja (Sankey)</h3>
        <Card className="bg-black/40 border-zinc-800/40 p-6 overflow-hidden">
          <div className="w-full h-[450px]">
            <svg ref={sankeyRef}></svg>
          </div>
        </Card>
      </div>
    </motion.div>
  </AnimatePresence>
  );
};

const Inventory = ({ onAddToCart }: { onAddToCart: (product: Product) => void }) => {
  const { store } = useContext(AuthContext);
  const [products, setProducts] = useState<Product[]>([]);
  const [isAdding, setIsAdding] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('add') === 'true';
  });
  const [loading, setLoading] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const handleSetIsAdding = (val: boolean) => {
    if (val === isAdding) return;
    setIsAdding(val);
    const params = new URLSearchParams(window.location.search);
    if (val) params.set('add', 'true');
    else params.delete('add');
    window.history.pushState({ add: val }, '', `?${params.toString()}`);
  };

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const params = new URLSearchParams(window.location.search);
      setIsAdding(params.get('add') === 'true');
      if (!params.get('edit')) setEditingProduct(null);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [addingToCartId, setAddingToCartId] = useState<string | null>(null);
  
  // New States for "Nuevo ingreso" flow
  const [formStep, setFormStep] = useState<'form' | 'confirmation'>('form');
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [formData, setFormData] = useState({
    material: '',
    provider: '',
    price: '',
    stock: ''
  });

  useEffect(() => {
    if (!store) return;
    const q = query(collection(db, 'products'), where('storeId', '==', store.id));
    return onSnapshot(q, (snap) => {
      setProducts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product)));
    });
  }, [store]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const resetForm = () => {
    setIsAdding(false);
    setEditingProduct(null);
    setFormStep('form');
    setSearchQuery('');
    setSelectedImage(null);
    setSelectedFile(null);
    setFormData({
      material: '',
      provider: '',
      price: '',
      stock: ''
    });
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      let imageUrl = selectedImage;
      
      // Convert/Compress image to Base64 to store directly in Firestore record
      if (selectedFile) {
        imageUrl = await compressImage(selectedFile);
      }

      const dataToSave = {
        name: searchQuery,
        material: formData.material,
        provider: formData.provider,
        price: parseFloat(formData.price) || 0,
        stock: parseInt(formData.stock) || 0,
        imageUrl: imageUrl,
        storeId: store?.id
      };

      if (editingProduct) {
        await updateDoc(doc(db, 'products', editingProduct.id), dataToSave);
      } else {
        const existingProduct = products.find(p => (p.name || '').toLowerCase().trim() === (searchQuery || '').toLowerCase().trim());
        if (existingProduct) {
          await updateDoc(doc(db, 'products', existingProduct.id), {
            stock: existingProduct.stock + dataToSave.stock,
            price: dataToSave.price,
            material: dataToSave.material || existingProduct.material,
            provider: dataToSave.provider || existingProduct.provider,
            imageUrl: dataToSave.imageUrl || existingProduct.imageUrl
          });
        } else {
          await addDoc(collection(db, 'products'), dataToSave);
        }
      }
      resetForm();
    } catch (error) {
      console.error("Error saving product:", error);
      alert("Error al guardar el producto.");
    } finally {
      setLoading(false);
    }
  };

  const filteredOptions = products.filter(p => 
    (p.name || '').toLowerCase().includes((searchQuery || '').toLowerCase())
  );

  return (
    <div className="space-y-2 relative pb-20">
      {/* Sticky Action Button */}
      <div className="sticky top-0 z-30 bg-black/80 backdrop-blur-md py-3 -mx-4 px-4 border-b border-zinc-800/50 mb-2 flex justify-center">
        <Button 
          onClick={() => setIsAdding(true)} 
          className="shadow-xl shadow-yellow-400/20 px-6 py-2.5 rounded-full text-[10px] md:text-xs font-bold flex items-center gap-2 border border-yellow-500/20 whitespace-nowrap uppercase tracking-wider transition-all hover:scale-105 active:scale-95"
        >
          <Plus size={16} /> REGISTRAR INGRESO
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {products.map(p => (
          <div key={p.id} className="bg-zinc-900/60 rounded-2xl border border-zinc-800/50 p-3 md:p-4 flex items-start justify-between hover:border-yellow-500/20 transition-all group shadow-xl relative overflow-hidden h-full">
            <div className="flex-1 min-w-0 pr-3 flex flex-col h-full justify-between">
              <div>
                <h3 className="text-white font-bold text-sm md:text-base mb-0.5 break-words uppercase tracking-tight leading-tight line-clamp-2">{p.name}</h3>
                <p className="text-zinc-400 text-[11px] break-words line-clamp-1">{p.material || 'Sin material'}</p>
                <p className="text-zinc-500 text-[8px] md:text-[9px] break-words mb-2 uppercase tracking-wider">Prov: {p.provider || '-'}</p>
                
                <div className="flex flex-col gap-1 mb-2">
                  <div className="flex items-center gap-1.5">
                    <p className="text-zinc-400 text-[9px] md:text-[10px]">Stock:</p>
                    <span className={cn("text-[10px] font-bold", p.stock < 10 ? "text-red-500" : "text-green-500")}>
                      {p.stock}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-yellow-400 font-black text-xs md:text-sm">
                      <span className="text-[8px] font-bold mr-0.5">S/</span>
                      {p.price.toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-1.5">
                <button 
                  onClick={() => {
                    setEditingProduct(p);
                    setSearchQuery(p.name);
                    setFormData({
                      material: p.material || '',
                      provider: p.provider || '',
                      price: p.price.toString(),
                      stock: p.stock.toString()
                    });
                    setSelectedImage(p.imageUrl || null);
                  }}
                  className="w-7 h-7 flex items-center justify-center bg-zinc-800/80 hover:bg-zinc-700/80 rounded-lg text-zinc-400 hover:text-yellow-400 transition-all border border-zinc-700/50 group/btn"
                >
                  <Edit size={14} className="transition-transform group-hover/btn:scale-110" />
                </button>
                <button 
                  onClick={() => setDeletingProduct(p)}
                  className="w-7 h-7 flex items-center justify-center bg-zinc-800/80 hover:bg-zinc-700/80 rounded-lg text-zinc-400 hover:text-red-500 transition-all border border-zinc-700/50 group/btn"
                >
                  <Trash2 size={14} className="transition-transform group-hover/btn:scale-110" />
                </button>
              </div>
            </div>
            
            <div className="flex flex-col items-center gap-2 flex-shrink-0 w-20 md:w-24">
              {p.imageUrl ? (
                <img src={p.imageUrl} alt={p.name} className="w-16 h-16 md:w-20 md:h-20 rounded-lg object-cover border border-zinc-800 shadow-lg" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-16 h-16 md:w-20 md:h-20 rounded-lg bg-zinc-800/30 flex items-center justify-center text-zinc-600 text-center p-1 text-[8px] uppercase font-bold border border-zinc-800/50">
                  Sin Foto
                </div>
              )}
              
              <button 
                onClick={() => {
                  onAddToCart(p);
                  setAddingToCartId(p.id);
                  setTimeout(() => setAddingToCartId(null), 1000);
                }}
                disabled={p.stock <= 0}
                className={cn(
                  "flex items-center justify-center gap-1 w-full py-1 rounded-lg text-[8px] font-black uppercase transition-all border tracking-widest",
                  addingToCartId === p.id 
                    ? "bg-green-500 text-black border-green-500 shadow-md shadow-green-500/20" 
                    : "bg-zinc-800/40 border-zinc-700/50 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                )}
              >
                <ShoppingCart size={10} />
                {addingToCartId === p.id ? 'OK' : 'Añadir'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {(isAdding || editingProduct) && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-lg">
            {formStep === 'form' ? (
              <Card className="max-h-[82vh] md:max-h-[85vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-bold text-white">Ingreso de Productos</h3>
                  <button onClick={resetForm} className="text-zinc-400 hover:text-white"><X /></button>
                </div>
                
                <div className="space-y-6 pb-6">
                  {/* Searchable Product Dropdown */}
                  <div className="relative">
                    <label className="text-sm text-zinc-400 mb-1 block">Producto</label>
                    <div className="relative">
                      <Input 
                        placeholder="Buscar o escribir nombre de producto..."
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          setShowDropdown(true);
                        }}
                        onFocus={() => setShowDropdown(true)}
                      />
                      <Search className="absolute right-3 top-2.5 text-zinc-500" size={18} />
                    </div>
                    
                      {showDropdown && searchQuery && (
                        <div className="absolute z-10 w-full mt-1 border rounded-lg shadow-2xl max-h-48 overflow-y-auto bg-zinc-900 border-zinc-800">
                          {filteredOptions.length > 0 ? (
                            filteredOptions.map(p => (
                              <button
                                key={p.id}
                                className="w-full text-left px-4 py-2 text-sm transition-colors flex items-center justify-between hover:bg-zinc-800 text-white"
                                onClick={() => {
                                  setSearchQuery(p.name);
                                  setFormData(prev => ({
                                    ...prev,
                                    material: p.material || '',
                                    provider: p.provider || '',
                                    price: p.price.toString()
                                  }));
                                  setSelectedImage(p.imageUrl || null);
                                  setShowDropdown(false);
                                }}
                              >
                                <span>{p.name}</span>
                              </button>
                            ))
                          ) : (
                            <button 
                              className="w-full text-left px-4 py-2 text-sm italic transition-colors hover:bg-zinc-800 text-zinc-500"
                              onClick={() => setShowDropdown(false)}
                            >
                              Nuevo producto: "{searchQuery}"
                            </button>
                          )}
                        </div>
                      )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm text-zinc-400 mb-1 block">Material</label>
                      <Input 
                        value={formData.material}
                        onChange={e => setFormData({...formData, material: e.target.value})}
                        placeholder="Ej: Algodón, Cuero..."
                      />
                    </div>
                    <div>
                      <label className="text-sm text-zinc-400 mb-1 block">Proveedor</label>
                      <Input 
                        value={formData.provider}
                        onChange={e => setFormData({...formData, provider: e.target.value})}
                        placeholder="Nombre del proveedor"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm text-zinc-400 mb-1 block">Precio (S/)</label>
                      <Input 
                        type="number"
                        step="0.01"
                        value={formData.price}
                        onChange={e => setFormData({...formData, price: e.target.value})}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-zinc-400 mb-1 block">Cantidad</label>
                      <Input 
                        type="number"
                        value={formData.stock}
                        onChange={e => setFormData({...formData, stock: e.target.value})}
                        placeholder="0"
                      />
                    </div>
                  </div>

                  {/* Photo Section */}
                  <div>
                    <label className="text-sm text-zinc-400 mb-2 block">Foto del Producto</label>
                    <div className="flex gap-4">
                      <label className="flex-1 flex items-center justify-center gap-2 border-2 border-dashed rounded-xl p-4 transition-colors cursor-pointer border-zinc-800 bg-zinc-900/30 hover:border-yellow-400/50">
                        <span className="text-xs text-zinc-400 font-medium">Subir foto</span>
                        <Upload className="text-zinc-500" size={18} />
                        <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
                      </label>
                      <label className="flex-1 flex items-center justify-center gap-2 border-2 border-dashed rounded-xl p-4 transition-colors cursor-pointer border-zinc-800 bg-zinc-900/30 hover:border-yellow-400/50">
                        <span className="text-xs text-zinc-400 font-medium">Tomar foto</span>
                        <Camera className="text-zinc-500" size={18} />
                        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageChange} />
                      </label>
                    </div>
                    {selectedImage && (
                      <div className="mt-4 relative group">
                        <img src={selectedImage} alt="Preview" className="w-full h-48 object-cover rounded-lg border border-zinc-800" referrerPolicy="no-referrer" />
                        <button 
                          onClick={() => setSelectedImage(null)}
                          className="absolute top-2 right-2 p-1 bg-red-500 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3 pt-4">
                    <Button variant="secondary" onClick={resetForm} className="hidden md:flex flex-1" disabled={loading}>
                      <ArrowLeft size={18} /> Volver
                    </Button>
                    <Button onClick={() => setFormStep('confirmation')} className="flex-1" disabled={!searchQuery || loading}>
                      Registrar
                    </Button>
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="max-h-[82vh] md:max-h-[85vh] overflow-y-auto pb-6">
                <div className="text-center mb-6">
                  <div className="w-16 h-16 bg-yellow-400/10 text-yellow-400 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 size={32} />
                  </div>
                  <h3 className="text-xl font-bold text-white">Revisa los datos del producto</h3>
                </div>

                  <div className="space-y-4 p-4 rounded-xl border mb-6 bg-zinc-800/30 border-zinc-800">
                    <div className="flex justify-between items-start">
                      <div className="space-y-2">
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Producto</p>
                          <p className="font-medium text-white">{searchQuery}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-[10px] uppercase tracking-wider text-zinc-500">Material</p>
                            <p className="text-sm text-zinc-300">{formData.material || '-'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-wider text-zinc-500">Proveedor</p>
                            <p className="text-sm text-zinc-300">{formData.provider || '-'}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-[10px] uppercase tracking-wider text-zinc-500">Precio</p>
                            <p className="font-bold text-sm text-white">S/ {parseFloat(formData.price || '0').toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-wider text-zinc-500">Cantidad</p>
                            <p className="font-bold text-sm text-white">{formData.stock || '0'} unid.</p>
                          </div>
                        </div>
                      </div>
                      {selectedImage && (
                        <img src={selectedImage} alt="Final preview" className="w-20 h-20 object-cover rounded-lg border border-zinc-700" referrerPolicy="no-referrer" />
                      )}
                    </div>
                  </div>

                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setFormStep('form')} className="flex-1 border-zinc-500" disabled={loading}>
                    Editar
                  </Button>
                  <Button onClick={handleSave} className="flex-1" disabled={loading}>
                    {loading ? 'Guardando...' : 'Guardar'}
                  </Button>
                </div>
              </Card>
            )}
          </motion.div>
        </div>
      )}

      {deletingProduct && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-sm">
            <Card className="text-center">
              <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 size={32} />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">¿Eliminar Producto?</h3>
              <p className="text-zinc-400 mb-6">Esta acción no se puede deshacer. Se eliminará "{deletingProduct.name}".</p>
              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => setDeletingProduct(null)} className="flex-1">Cancelar</Button>
                <Button onClick={async () => {
                  await deleteDoc(doc(db, 'products', deletingProduct.id));
                  setDeletingProduct(null);
                }} className="flex-1 bg-red-500 hover:bg-red-600 border-red-500">Eliminar</Button>
              </div>
            </Card>
          </motion.div>
        </div>
      )}

      {/* Floating Action Button - Removed and moved to top */}
    </div>
  );
};

const POS = ({ cart, setCart, addToCart, removeFromCart, updateQuantity }: { 
  cart: { product: Product; quantity: number }[], 
  setCart: React.Dispatch<React.SetStateAction<{ product: Product; quantity: number }[]>>,
  addToCart: (product: Product) => void,
  removeFromCart: (productId: string) => void,
  updateQuantity: (productId: string, delta: number) => void
}) => {
  const { store, profile } = useContext(AuthContext);
  const [products, setProducts] = useState<Product[]>([]);
  const [sellers, setSellers] = useState<UserProfile[]>([]);
  const [selectedSellerId, setSelectedSellerId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [docType, setDocType] = useState<'boleta' | 'factura'>('boleta');
  const [buyerName, setBuyerName] = useState('');
  const [buyerDni, setBuyerDni] = useState('');
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [buyerDniError, setBuyerDniError] = useState(false);

  useEffect(() => {
    if (profile) {
      setSelectedSellerId(profile.uid);
    }
  }, [profile]);

  useEffect(() => {
    if (!store) return;
    
    // Fetch products
    const qProducts = query(collection(db, 'products'), where('storeId', '==', store.id));
    const unsubProducts = onSnapshot(qProducts, (snap) => {
      setProducts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product)));
    });

    // Fetch all users (sellers and owner) for the store
    const qUsers = query(collection(db, 'users'), where('storeId', '==', store.id));
    const unsubUsers = onSnapshot(qUsers, (snap) => {
      setSellers(snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    });

    return () => { unsubProducts(); unsubUsers(); };
  }, [store]);

  const handleLookup = async () => {
    if (!buyerDni || (buyerDni.length !== 8 && buyerDni.length !== 11)) return;
    
    setIsLookingUp(true);
    try {
      const type = buyerDni.length === 8 ? 'dni' : 'ruc';
      const response = await fetch(`/api/lookup/${type}/${buyerDni}`);
      const data = await response.json();
      
      if (data.success) {
        if (type === 'dni') {
          const fullName = data.nombre_completo || data.nombreCompleto;
          if (fullName) {
            setBuyerName(fullName);
          } else {
            const names = data.nombres || data.names;
            const paterno = data.apellido_paterno || data.apellidoPaterno;
            const materno = data.apellido_materno || data.apellidoMaterno;
            const nameParts = [names, paterno, materno].filter(part => part && part !== 'undefined');
            setBuyerName(nameParts.join(' '));
          }
        } else {
          setBuyerName(data.razon_social || data.razonSocial);
        }
      }
    } catch (error) {
      console.error("Lookup error:", error);
    } finally {
      setIsLookingUp(false);
    }
  };

  useEffect(() => {
    if (showSuccess) {
      const timer = setTimeout(() => setShowSuccess(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [showSuccess]);

  const filteredProducts = products.filter(p => 
    (p.name || '').toLowerCase().includes((search || '').toLowerCase()) || 
    (p.sku || '').toLowerCase().includes((search || '').toLowerCase())
  );

  const total = cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);

  const handleCheckout = async () => {
    if (!buyerDni) {
      setBuyerDniError(true);
      return;
    }
    setBuyerDniError(false);
    
    if (!store || !profile || cart.length === 0) return;

    const selectedSeller = sellers.find(s => s.uid === selectedSellerId) || profile;

    const saleData = {
      total,
      items: cart.map(item => ({
        productId: item.product.id,
        name: item.product.name,
        quantity: item.quantity,
        price: item.product.price
      })),
      timestamp: new Date().toISOString(),
      storeId: store.id,
      sellerId: selectedSeller.uid,
      sellerName: selectedSeller.displayName || selectedSeller.email,
      documentType: docType,
      buyerName,
      buyerDni
    };

    try {
      await addDoc(collection(db, 'sales'), saleData);
      for (const item of cart) {
        await updateDoc(doc(db, 'products', item.product.id), {
          stock: item.product.stock - item.quantity
        });
      }
      setCart([]);
      setBuyerName('');
      setBuyerDni('');
      setShowSuccess(true);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex flex-col lg:grid lg:grid-cols-3 gap-6 h-full md:min-h-[calc(100vh-12rem)]">
      <div className="lg:col-span-2 flex flex-col gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
          <Input 
            placeholder="Buscar por nombre o SKU..." 
            className="pl-10 py-3" 
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 overflow-y-auto flex-1 pr-1 pb-4">
          {search.length > 0 ? (
            filteredProducts.length > 0 ? (
              filteredProducts.map(p => (
                <button 
                  key={p.id} 
                  onClick={() => addToCart(p)}
                  disabled={p.stock <= 0}
                  className="border p-2 px-3 rounded-lg flex justify-between items-center gap-3 transition-all group disabled:opacity-50 active:scale-[0.98] bg-zinc-900 border-zinc-800 hover:border-yellow-400/50"
                >
                  <div className="flex-1 min-w-0 text-left">
                    <p className="font-bold text-xs md:text-sm text-white group-hover:text-yellow-400 truncate tracking-tight">{p.name}</p>
                    <p className="text-zinc-500 text-[9px] uppercase tracking-wider truncate">{p.sku}</p>
                  </div>
                  <div className="text-right flex flex-col items-end">
                    <p className="font-bold text-xs md:text-sm text-yellow-400 whitespace-nowrap">S/ {p.price.toFixed(2)}</p>
                    <p className="text-zinc-500 text-[9px]">{p.stock} st.</p>
                  </div>
                </button>
              ))
            ) : (
              <div className="col-span-full h-full flex flex-col items-center justify-center text-zinc-500 py-10">
                <Search size={40} className="mb-2 opacity-20" />
                <p>No se encontraron productos</p>
              </div>
            )
          ) : null}
        </div>
      </div>

      <Card className="flex flex-col min-h-[500px] lg:h-full border-zinc-800 bg-zinc-900/30 p-3">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Carrito</h3>
          <div className="flex rounded-lg p-0.5 bg-zinc-800">
            {['boleta', 'factura'].map((type) => (
              <button 
                key={type}
                onClick={() => setDocType(type as any)}
                className={cn("px-2 py-1 text-[10px] rounded-md transition-all capitalize", docType === type ? "bg-yellow-400 text-black font-bold" : "text-zinc-500")}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3 mb-4">
          <div>
            <label className="text-[9px] uppercase tracking-widest text-zinc-500 mb-1 block">Vendedor</label>
            <select 
              value={selectedSellerId}
              onChange={(e) => setSelectedSellerId(e.target.value)}
              className="w-full border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-yellow-400/50 transition-all bg-zinc-900 border-zinc-800 text-white"
            >
              {sellers.map(s => (
                <option key={s.uid} value={s.uid}>
                  {s.displayName || s.email} {s.role === 'admin' ? '(Admin)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-[9px] uppercase tracking-widest text-zinc-500 mb-1 block">Cliente</label>
            <div className="relative group">
              <Input 
                placeholder="DNI / RUC" 
                className={cn("text-xs h-8 pr-8", buyerDniError && "border-red-500 focus:ring-red-500/50")}
                value={buyerDni}
                onChange={e => {
                  setBuyerDni(e.target.value);
                  if (buyerDniError) setBuyerDniError(false);
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
              />
              <button 
                onClick={handleLookup}
                disabled={isLookingUp || !buyerDni}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-yellow-400 disabled:opacity-50 transition-colors"
              >
                {isLookingUp ? (
                  <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Search size={14} />
                )}
              </button>
            </div>
            {buyerDniError && (
              <p className="text-[9px] text-red-500 font-medium">Introduce el documento*</p>
            )}
            <Input 
              placeholder="Nombre del comprador" 
              className="text-xs h-8"
              value={buyerName}
              onChange={e => setBuyerName(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 space-y-2 mb-4 overflow-y-auto min-h-0 pr-1">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-600 gap-2 opacity-50 py-10">
              <ShoppingCart size={32} />
              <p className="text-[10px] uppercase font-bold tracking-widest">Vacío</p>
            </div>
          ) : (
            cart.map(item => (
              <div key={item.product.id} className="p-1.5 rounded-lg border bg-zinc-900/40 border-zinc-800/60 transition-all hover:border-zinc-700">
                <div className="flex gap-2">
                  <div className="w-8 h-8 rounded bg-zinc-800 overflow-hidden flex-shrink-0 border border-zinc-800/50">
                    {item.product.imageUrl ? (
                      <img src={item.product.imageUrl} alt={item.product.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-700"><Package size={12} /></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start">
                      <p className="text-[10px] font-bold truncate text-white leading-tight pr-1 uppercase tracking-tight">{item.product.name}</p>
                      <button onClick={() => removeFromCart(item.product.id)} className="text-zinc-600 hover:text-red-500 transition-colors"><X size={10} /></button>
                    </div>
                    <div className="flex justify-between items-center mt-1">
                      <div className="flex items-center gap-1.5 bg-black/30 rounded-md border border-zinc-800/50 px-1 py-0.5">
                        <button onClick={() => updateQuantity(item.product.id, -1)} className="text-zinc-500 hover:text-white px-0.5 text-[10px]">-</button>
                        <span className="text-[10px] font-bold min-w-[12px] text-center text-zinc-300">{item.quantity}</span>
                        <button onClick={() => updateQuantity(item.product.id, 1)} className="text-zinc-500 hover:text-white px-0.5 text-[10px]">+</button>
                      </div>
                      <p className="text-[10px] font-black text-yellow-400">S/ {(item.product.price * item.quantity).toFixed(2)}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-zinc-800 pt-3 space-y-2 mt-auto">
          {showSuccess && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-green-500/10 border border-green-500/20 p-2 rounded text-green-500 text-[10px] text-center font-bold">¡Venta Realizada!</motion.div>
          )}
          <div className="space-y-1">
            <div className="flex justify-between items-center text-zinc-500 text-[9px] uppercase tracking-wider">
              <span>Subtotal</span>
              <span>S/ {(total * 0.82).toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-zinc-500 text-[9px] uppercase tracking-wider">
              <span>IGV (18%)</span>
              <span>S/ {(total * 0.18).toFixed(2)}</span>
            </div>
          </div>
          <div className="flex justify-between items-center text-white border-t border-zinc-800/50 pt-2 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Total a Pagar</span>
            <span className="text-lg font-black text-yellow-400">S/ {total.toFixed(2)}</span>
          </div>
          <Button onClick={handleCheckout} disabled={cart.length === 0} className="w-full h-10 text-xs font-black uppercase tracking-widest bg-yellow-400 hover:bg-yellow-500 text-black shadow-lg shadow-yellow-400/10">
            REALIZAR VENTA
          </Button>
        </div>
      </Card>
    </div>
  );
};

const ProfileView = () => {
  const { profile, store } = useContext(AuthContext);
  const [view, setView] = useState<'menu' | 'data' | 'sellers'>(() => {
    const params = new URLSearchParams(window.location.search);
    const pview = params.get('pv');
    const valid = ['menu', 'data', 'sellers'];
    return (valid.includes(pview || '') ? pview : 'menu') as any;
  });

  const handleProfileViewChange = (newView: typeof view) => {
    if (newView === view) return;
    setView(newView);
    const params = new URLSearchParams(window.location.search);
    params.set('pv', newView);
    window.history.pushState({ pv: newView }, '', `?${params.toString()}`);
  };

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const params = new URLSearchParams(window.location.search);
      const pview = params.get('pv') || 'menu';
      setView(pview as any);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
  const [showPassword, setShowPassword] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;

    setUploadingPhoto(true);
    try {
      const photoUrl = await uploadImage(file, `profiles/${profile.uid}/${Date.now()}`);
      await updateDoc(doc(db, 'users', profile.uid), {
        photoUrl: photoUrl
      });
      alert('Foto de perfil actualizada con éxito.');
    } catch (error) {
      console.error('Error uploading photo:', error);
      alert('Error al actualizar la foto de perfil.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  if (view === 'data') {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="data"
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.2 }}
          className="space-y-6"
        >
          <button onClick={() => handleProfileViewChange('menu')} className="hidden md:flex items-center gap-2 text-zinc-500 hover:text-yellow-400 transition-colors mb-4">
            <ChevronRight className="rotate-180" size={20} /> Volver al Perfil
          </button>
        <h2 className="text-[20px] font-bold text-center uppercase tracking-wider mb-6 text-white">Mis Datos</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="space-y-4">
            <div className="flex items-center gap-3 border-b pb-4 mb-4 border-zinc-800">
              <UserIcon className="text-yellow-400" size={20} />
              <h3 className="font-bold text-white">Información Personal</h3>
            </div>
            <div className="space-y-3">
              <div className="flex flex-col items-center mb-6">
                <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                  {profile?.photoUrl ? (
                    <img src={profile.photoUrl} alt="Profile" className="w-24 h-24 rounded-full object-cover border-2 border-yellow-400" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-24 h-24 rounded-full flex items-center justify-center border-2 text-yellow-400 bg-zinc-800 border-yellow-400/50">
                      <UserCircle size={48} strokeWidth={1.5} />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/50 rounded-full opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <Camera size={24} className="text-white" />
                  </div>
                  {uploadingPhoto && (
                    <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center">
                      <div className="w-5 h-5 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
                <p className="text-xs text-zinc-500 mt-2">Click para cambiar foto</p>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handlePhotoUpload} 
                  accept="image/*" 
                  className="hidden" 
                />
              </div>
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-widest">Nombre</p>
                <p className="font-medium text-white">{profile?.displayName || 'No especificado'}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-widest">Correo</p>
                <p className="font-medium text-white">{profile?.email}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-widest">Contraseña</p>
                <div className="flex items-center justify-between">
                  <p className="font-medium text-white">{showPassword ? (profile?.password || 'No registrada') : '••••••••'}</p>
                  <button 
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-yellow-400 text-xs hover:underline"
                  >
                    {showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                  </button>
                </div>
              </div>
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-widest">Rol</p>
                <span className="inline-block px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-widest mt-1 bg-zinc-800 text-yellow-400">
                  {profile?.role === 'admin' ? 'Administrador' : 'Vendedor'}
                </span>
              </div>
            </div>
          </Card>

          <Card className="space-y-4">
            <div className="flex items-center gap-3 border-b pb-4 mb-4 border-zinc-800">
              <StoreIcon className="text-yellow-400" size={20} />
              <h3 className="font-bold text-white">Datos de la Tienda</h3>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-widest">Nombre Comercial</p>
                <p className="font-medium text-white">{store?.name}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-widest">RUC</p>
                <p className="font-medium text-white">{store?.ruc}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-widest">Fecha de Registro</p>
                <p className="font-medium text-white">{store?.createdAt ? format(new Date(store.createdAt), 'dd/MM/yyyy') : '-'}</p>
              </div>
            </div>
            </Card>
          </div>
        </motion.div>
      </AnimatePresence>
    );
  }

  if (view === 'sellers') {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="sellers"
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.2 }}
        >
          <button onClick={() => handleProfileViewChange('menu')} className="hidden md:flex items-center gap-2 text-zinc-500 hover:text-yellow-400 transition-colors mb-4">
            <ChevronRight className="rotate-180" size={20} /> Volver al Perfil
          </button>
          <UserManagement />
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="menu"
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 10 }}
        transition={{ duration: 0.2 }}
        className="max-w-2xl mx-auto space-y-6"
      >
      <div className="flex flex-col items-center text-center mb-10">
        <div className="mb-4">
          {profile?.photoUrl ? (
            <img src={profile.photoUrl} alt="Profile" className="w-20 h-20 rounded-full object-cover border-2 border-yellow-400" referrerPolicy="no-referrer" />
          ) : (
            <div className="w-20 h-20 bg-zinc-800 rounded-full flex items-center justify-center border-2 border-yellow-400/50 text-yellow-400">
              <UserCircle size={64} strokeWidth={1.5} />
            </div>
          )}
        </div>
        <h2 className="text-[20px] font-bold text-white">{profile?.displayName}</h2>
        <p className="text-zinc-500">{profile?.email}</p>
        <span className="mt-2 px-3 py-1 bg-yellow-400/10 text-yellow-400 text-xs font-bold rounded-full uppercase tracking-widest">
          {profile?.role === 'admin' ? 'Administrador' : 'Vendedor'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <button 
          onClick={() => handleProfileViewChange('data')}
          className="flex items-center justify-between p-5 border rounded-2xl transition-all group bg-zinc-900/50 border-zinc-800 hover:border-yellow-400"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-500/10 rounded-xl text-blue-500 group-hover:bg-blue-500/20 transition-colors">
              <Shield size={24} />
            </div>
            <div className="text-left">
              <p className="font-bold text-white">Mis Datos</p>
              <p className="text-zinc-500 text-xs">Información personal y de la tienda</p>
            </div>
          </div>
          <ChevronRight className="text-zinc-600 group-hover:text-yellow-400 transition-colors" />
        </button>

        <div className="flex items-center justify-between p-5 border rounded-2xl transition-all group bg-zinc-900/50 border-zinc-800 hover:border-yellow-400">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-500/10 rounded-xl text-purple-500 group-hover:bg-purple-500/20 transition-colors">
              <Settings size={24} />
            </div>
            <div className="text-left">
              <p className="font-bold text-white">Notificaciones Push</p>
              <p className="text-zinc-500 text-xs">Recibe alertas de llegada y salida</p>
            </div>
          </div>
          <button 
            onClick={async () => {
              const granted = await requestNotificationPermission();
              if (granted) {
                alert("Notificaciones habilitadas con éxito.");
                triggerSystemNotification("Tienda Goo!", "Las notificaciones están activas.");
              } else {
                alert("Las notificaciones están bloqueadas. Habilítalas en la configuración de tu navegador.");
              }
            }}
            className="px-3 py-1 bg-zinc-800 text-yellow-400 rounded-lg text-xs font-bold hover:bg-zinc-700 transition-colors"
          >
            {("Notification" in window && Notification.permission === 'granted') ? '✓ Activo' : 'Activar'}
          </button>
        </div>

        {profile?.role === 'admin' && (
          <button 
            onClick={() => handleProfileViewChange('sellers')}
            className="flex items-center justify-between p-5 border rounded-2xl transition-all group bg-zinc-900/50 border-zinc-800 hover:border-yellow-400"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 bg-yellow-500/10 rounded-xl text-yellow-500 group-hover:bg-yellow-500/20 transition-colors">
                <Users size={24} />
              </div>
              <div className="text-left">
                <p className="font-bold text-white">Mis Vendedores</p>
                <p className="text-zinc-500 text-xs">Gestionar equipo de ventas</p>
              </div>
            </div>
            <ChevronRight className="text-zinc-600 group-hover:text-yellow-400 transition-colors" />
          </button>
        )}

        <button 
          onClick={() => signOut(auth)}
          className="flex items-center justify-between p-5 bg-red-500/5 border border-red-500/10 rounded-2xl hover:bg-red-500/10 transition-all group mt-4"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 bg-zinc-800 rounded-xl text-red-500">
              <LogOut size={24} />
            </div>
            <div className="text-left">
              <p className="text-red-500 font-bold">Cerrar Sesión</p>
              <p className="text-red-500/50 text-xs">Salir de tu cuenta de forma segura</p>
            </div>
          </div>
        </button>
      </div>
    </motion.div>
  </AnimatePresence>
  );
};

const UserManagement = () => {
  const { store } = useContext(AuthContext);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [showSellerDetailsPassword, setShowSellerDetailsPassword] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!store) return;
    const q = query(
      collection(db, 'users'), 
      where('storeId', '==', store.id),
      where('role', '==', 'seller')
    );
    return onSnapshot(q, (snap) => {
      setUsers(snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    });
  }, [store]);

  const handleAddSeller = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    const emailOrPhone = formData.get('email') as string;
    const password = formData.get('password') as string;
    const name = formData.get('name') as string;

    // Normalize email/phone for Auth
    let authEmail = emailOrPhone;
    if (!emailOrPhone.includes('@')) {
      // Assume it's a phone number, normalize it
      const cleanPhone = emailOrPhone.replace(/\D/g, '');
      authEmail = `${cleanPhone}@tiendagoo.com`;
    }

    let secondaryApp;
    try {
      // Create a secondary Firebase app to create the user without signing out the admin
      const secondaryAppName = `SecondaryApp-${Date.now()}`;
      secondaryApp = initializeApp(firebaseConfig, secondaryAppName);
      const secondaryAuth = getAuth(secondaryApp);
      
      // 1. Create the Auth account
      const userCredential = await createUserWithEmailAndPassword(secondaryAuth, authEmail, password);
      const uid = userCredential.user.uid;

      // 2. Save to Firestore with the same UID
      const newUser = {
        email: emailOrPhone, // Store original input (email or phone)
        authEmail: authEmail, // Store normalized email used for auth
        displayName: name,
        role: 'seller' as UserRole,
        storeId: store?.id,
        password: password, // Store password so admin can see it in details
        createdAt: serverTimestamp()
      };
      
      await setDoc(doc(db, 'users', uid), newUser);
      
      // Trigger automated registration/verification email template from Firebase console for the seller
      if (emailOrPhone.includes('@')) {
        try {
          await sendEmailVerification(userCredential.user);
        } catch (emailErr) {
          console.error("Error sending verification email to seller:", emailErr);
        }
      }
      
      // 3. Sign out from secondary app and cleanup
      await signOut(secondaryAuth);
      setIsAdding(false);
    } catch (error: any) {
      console.error("Error creating seller:", error);
      if (error.code === 'auth/email-already-in-use') {
        alert('Este correo electrónico ya esta en uso.');
      } else {
        alert(`Error: ${error.message}`);
      }
    } finally {
      if (secondaryApp) {
        await deleteApp(secondaryApp);
      }
      setLoading(false);
    }
  };

  const handleDeleteSeller = async (userId: string) => {
    if (!window.confirm('¿Estás seguro de que deseas eliminar esta cuenta de vendedor? Esta acción no se puede deshacer.')) return;
    
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, 'users', userId));
      setSelectedUser(null);
    } catch (e) {
      console.error("Error deleting seller:", e);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-4 relative pb-20">
      <h2 className="text-[20px] font-bold text-center uppercase tracking-wider text-white">Mis Vendedores</h2>

      {/* Sticky Action Button */}
      <div className="sticky top-0 z-30 backdrop-blur-md py-3 -mx-4 px-4 border-b mb-2 flex justify-center bg-black/80 border-zinc-800/50">
        <Button 
          onClick={() => setIsAdding(true)} 
          className="shadow-xl shadow-yellow-400/20 px-6 py-2.5 rounded-full text-[10px] md:text-xs font-bold flex items-center gap-2 border border-yellow-500/20 whitespace-nowrap uppercase tracking-wider transition-all hover:scale-105 active:scale-95"
        >
          <Plus size={16} /> REGISTRAR VENDEDOR
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {users.map(u => (
          <Card key={u.uid} className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center border bg-zinc-800 text-yellow-400 border-zinc-700">
                <UserCircle size={28} />
              </div>
              <div>
                <p className="font-bold text-white">{u.displayName || 'Vendedor'}</p>
                <p className="text-zinc-500 text-sm">{u.email}</p>
              </div>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              className="w-full text-xs"
              onClick={() => {
                setSelectedUser(u);
                setShowSellerDetailsPassword(false);
              }}
            >
              Ver detalles
            </Button>
          </Card>
        ))}
      </div>

      {isAdding && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md">
            <Card>
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-white">Registrar Vendedor</h3>
                <button onClick={() => setIsAdding(false)} className="text-zinc-400 hover:text-white"><X /></button>
              </div>
              <form onSubmit={handleAddSeller} className="space-y-4">
                <div>
                  <label className="text-sm text-zinc-400 mb-1 block">Nombre Completo</label>
                  <Input name="name" required />
                </div>
                <div>
                  <label className="text-sm text-zinc-400 mb-1 block">Correo electrónico / Teléfono</label>
                  <Input name="email" required />
                </div>
                <div>
                  <label className="text-sm text-zinc-400 mb-1 block">Contraseña Temporal</label>
                  <div className="relative">
                    <Input 
                      name="password" 
                      type={showPassword ? "text" : "password"} 
                      required 
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
                <Button type="submit" className="w-full mt-4" disabled={loading}>
                  {loading ? 'Registrando...' : 'Crear Cuenta'}
                </Button>
              </form>
            </Card>
          </motion.div>
        </div>
      )}

      {selectedUser && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md">
            <Card>
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-white">Detalles del Vendedor</h3>
                <button onClick={() => setSelectedUser(null)} className="text-zinc-400 hover:text-white"><X /></button>
              </div>
              <div className="space-y-4">
                <div className="p-4 bg-zinc-900/50 rounded-xl border border-zinc-800">
                  <p className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Nombre</p>
                  <p className="text-white font-medium">{selectedUser.displayName}</p>
                </div>
                <div className="p-4 bg-zinc-900/50 rounded-xl border border-zinc-800">
                  <p className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Correo / Usuario</p>
                  <p className="text-white font-medium">{selectedUser.email}</p>
                </div>
                <div className="p-4 bg-zinc-900/50 rounded-xl border border-zinc-800">
                  <p className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Contraseña</p>
                  <div className="flex items-center justify-between">
                    <p className="text-white font-medium">
                      {showSellerDetailsPassword ? (selectedUser.password || 'No asignada') : '••••••••'}
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowSellerDetailsPassword(!showSellerDetailsPassword)}
                      className="text-yellow-400 hover:text-yellow-300 transition-colors"
                    >
                      {showSellerDetailsPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
              </div>
              <div className="mt-8 space-y-3">
                <Button 
                  variant="outline" 
                  className="w-full border-red-500/20 text-red-500 hover:bg-red-500/10 hover:border-red-500"
                  onClick={() => selectedUser && handleDeleteSeller(selectedUser.uid)}
                  disabled={isDeleting}
                >
                  <Trash2 size={18} className="mr-2" />
                  {isDeleting ? 'Eliminando...' : 'Eliminar cuenta de vendedor'}
                </Button>
                <Button onClick={() => setSelectedUser(null)} className="w-full">Cerrar</Button>
              </div>
            </Card>
          </motion.div>
        </div>
      )}

      {/* Floating Action Button - Removed and moved to top */}
    </div>
  );
};

const Asistencia = () => {
  const { store, profile } = useContext(AuthContext);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [sellers, setSellers] = useState<Record<string, UserProfile>>({});
  const [isCapturing, setIsCapturing] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attendanceType, setAttendanceType] = useState<'ingreso' | 'salida' | null>(null);
  const [newRecordNotification, setNewRecordNotification] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<'hoy' | 'ayer' | 'especifica'>('hoy');
  const [specificDate, setSpecificDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const previousRecordsLength = React.useRef(0);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const dateInputRef = React.useRef<HTMLInputElement>(null);

  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);

  // Helper to get date in Peru time (UTC-5)
  const getPeruDate = (timestamp: string) => {
    const date = new Date(timestamp);
    // Adjust to UTC
    const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
    // Adjust to Peru (UTC-5)
    const peruDate = new Date(utc - (5 * 3600000));
    return peruDate.toISOString().split('T')[0];
  };

  const todayPeru = getPeruDate(new Date().toISOString());
  const hasEntryToday = profile?.role !== 'admin' && records.some(r => r.type === 'ingreso' && getPeruDate(r.timestamp) === todayPeru);

  useEffect(() => {
    if (!store || !profile) return;
    
    let startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    let endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    if (profile.role !== 'admin') {
      // For sellers, we always show last 7 days
      startDate.setDate(startDate.getDate() - 7);
    } else {
      if (dateFilter === 'ayer') {
        startDate.setDate(startDate.getDate() - 1);
        endDate.setDate(endDate.getDate() - 1);
      } else if (dateFilter === 'especifica' && specificDate) {
        startDate = new Date(specificDate);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(specificDate);
        endDate.setHours(23, 59, 59, 999);
      }
    }

    const baseQuery = collection(db, 'attendance');
    let q;
    
    if (profile.role !== 'admin') {
      q = query(
        baseQuery,
        where('storeId', '==', store.id),
        where('sellerId', '==', profile.uid),
        where('timestamp', '>=', startDate.toISOString()),
        orderBy('timestamp', 'desc')
      );
    } else {
      q = query(
        baseQuery, 
        where('storeId', '==', store.id),
        where('timestamp', '>=', startDate.toISOString()),
        where('timestamp', '<=', endDate.toISOString()),
        orderBy('timestamp', 'desc'), 
        limit(100)
      );
    }
    
    return onSnapshot(q, (snap) => {
      const newRecords = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as AttendanceRecord));
      
      if (previousRecordsLength.current > 0 && newRecords.length > previousRecordsLength.current) {
        setNewRecordNotification(true);
        setTimeout(() => setNewRecordNotification(false), 5000);
      }
      previousRecordsLength.current = newRecords.length;
      
      setRecords(newRecords);
    });
  }, [store, dateFilter, specificDate]);

  useEffect(() => {
    if (profile?.role === 'admin' && store) {
      const q = query(collection(db, 'users'), where('storeId', '==', store.id));
      return onSnapshot(q, (snap) => {
        const usersMap: Record<string, UserProfile> = {};
        snap.docs.forEach(doc => {
          usersMap[doc.id] = doc.data() as UserProfile;
        });
        setSellers(usersMap);
      });
    }
  }, [profile?.role, store]);

  const startCamera = async (type: 'ingreso' | 'salida') => {
    setAttendanceType(type);
    setIsCapturing(true);
    setImageSrc(null);
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      setCameraError("No se pudo acceder a la cámara. Si estás en la vista previa de AI Studio, intenta abrir el app en una nueva pestaña usando el botón arriba a la derecha de la barra de AI Studio para otorgar permisos.");
      setIsCapturing(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
    setIsCapturing(false);
  };

  const capturePhoto = async () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        const width = videoRef.current.videoWidth;
        const height = videoRef.current.videoHeight;
        canvasRef.current.width = width;
        canvasRef.current.height = height;
        
        // Mirror horizontally on capture
        context.translate(width, 0);
        context.scale(-1, 1);
        
        context.drawImage(videoRef.current, 0, 0, width, height);
        
        // Reset transformation state
        context.setTransform(1, 0, 0, 1, 0, 0);
        
        const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.8);
        setImageSrc(dataUrl);
        stopCamera();
        
        // Trigger registration automatically
        await handleRegister(dataUrl);
      }
    }
  };

  const handleRegister = async (capturedImageData?: string) => {
    const finalImage = capturedImageData || imageSrc;
    if (!store || !profile || !finalImage || !attendanceType) return;
    setLoading(true);
    try {
      const storagePath = `attendance/${store.id}/${profile.uid}/${Date.now()}.jpg`;
      const photoUrl = await uploadImage(finalImage, storagePath);
      
      await addDoc(collection(db, 'attendance'), {
        storeId: store.id,
        sellerId: profile.uid,
        sellerName: profile.displayName || profile.email,
        timestamp: new Date().toISOString(),
        imageUrl: photoUrl,
        type: attendanceType
      });
      setImageSrc(null);
      setAttendanceType(null);
      alert("Asistencia registrada con éxito.");
    } catch (e) {
      console.error(e);
      alert("Error al registrar asistencia.");
    } finally {
      setLoading(false);
    }
  };

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return (
    <div className="space-y-8">
      {profile?.role === 'admin' && newRecordNotification && (
        <div className="flex justify-end">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }} 
            animate={{ opacity: 1, scale: 1 }} 
            className="bg-green-500/10 text-green-500 px-3 py-1 rounded-full text-xs font-bold border border-green-500/20 flex items-center gap-2"
          >
            <CheckCircle2 size={14} />
            Nuevo registro recibido
          </motion.div>
        </div>
      )}

      {profile?.role !== 'admin' && (
        <div className="max-w-md mx-auto">
          <Card className="flex flex-col items-center gap-6">
            {cameraError && (
              <div className="w-full p-3 rounded-xl text-xs bg-red-500/10 text-red-500 border border-red-500/20 text-left">
                {cameraError}
              </div>
            )}
            {!isCapturing && !imageSrc && (
              <div className="text-center space-y-4 w-full">
                <div className="w-24 h-24 bg-yellow-400/10 text-yellow-400 rounded-full flex items-center justify-center mx-auto">
                  <Camera size={40} />
                </div>
                <p className="text-zinc-400">Tómate una selfie para registrar tu asistencia.</p>
                <div className="flex flex-col items-center gap-3 w-full mt-4">
                  <div className="w-full space-y-2">
                    <Button 
                      onClick={() => startCamera('ingreso')} 
                      variant="outline"
                      className={cn(
                        "w-full border-green-500/30 text-green-500 hover:bg-green-500/10 hover:text-green-400",
                        hasEntryToday && "opacity-50 cursor-not-allowed grayscale"
                      )}
                      disabled={hasEntryToday}
                    >
                      {hasEntryToday ? 'Ingreso Registrado' : 'Registrar Ingreso'}
                    </Button>
                    {hasEntryToday && (
                      <p className="text-[10px] text-zinc-500 text-center">Ya registraste tu ingreso el día de hoy.</p>
                    )}
                  </div>
                  <Button 
                    onClick={() => startCamera('salida')} 
                    variant="outline"
                    className="w-full border-red-500/30 text-red-500 hover:bg-red-500/10 hover:text-red-400"
                  >
                    Registrar Salida
                  </Button>
                </div>
              </div>
            )}

            {isCapturing && (
              <div className="w-full space-y-4">
                <div className="relative rounded-xl overflow-hidden bg-black aspect-[3/4]">
                  <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover scale-x-[-1]" />
                </div>
                <div className="flex gap-3">
                  <Button variant="secondary" onClick={stopCamera} className="flex-1" disabled={loading}>Cancelar</Button>
                  <Button onClick={capturePhoto} className="flex-1" disabled={loading}>
                    {loading ? 'Procesando...' : 'Capturar'}
                  </Button>
                </div>
              </div>
            )}

            {imageSrc && (
              <div className="w-full space-y-4">
                <div className="relative rounded-xl overflow-hidden bg-black aspect-[3/4]">
                  <img src={imageSrc} alt="Selfie" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-3">
                    <div className="w-8 h-8 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                    <p className="text-white font-bold text-sm uppercase tracking-widest">Registrando...</p>
                  </div>
                </div>
              </div>
            )}
            <canvas ref={canvasRef} className="hidden" />
          </Card>
        </div>
      )}

      <div className="space-y-4">
        {profile?.role === 'admin' ? (
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div className="flex border border-zinc-800 p-1 rounded-xl w-full sm:w-auto overflow-x-auto bg-zinc-900">
              <button 
                onClick={() => setDateFilter('hoy')}
                className={cn(
                  "flex-1 sm:flex-none px-4 py-2 text-[10px] sm:text-xs rounded-lg transition-all whitespace-nowrap", 
                  dateFilter === 'hoy' 
                    ? "bg-yellow-400 text-black font-bold" 
                    : "text-zinc-400 hover:text-white"
                )}
              >
                HOY
              </button>
              <button 
                onClick={() => setDateFilter('ayer')}
                className={cn(
                  "flex-1 sm:flex-none px-4 py-2 text-[10px] sm:text-xs rounded-lg transition-all whitespace-nowrap", 
                  dateFilter === 'ayer' 
                    ? "bg-yellow-400 text-black font-bold" 
                    : "text-zinc-400 hover:text-white"
                )}
              >
                AYER
              </button>
              <div className="relative flex items-center flex-1 sm:flex-none">
                <div 
                  className={cn(
                    "flex-1 sm:flex-none px-4 py-2 text-[10px] sm:text-xs rounded-lg transition-all whitespace-nowrap flex items-center gap-2", 
                    dateFilter === 'especifica' 
                      ? "bg-yellow-400 text-black font-bold shadow-lg shadow-yellow-400/20 px-6" 
                      : "text-zinc-400 hover:text-white border border-zinc-800"
                  )}
                >
                  <Calendar size={14} className={dateFilter === 'especifica' ? 'text-black' : 'text-zinc-500'} />
                  <span>{dateFilter === 'especifica' ? format(new Date(specificDate + 'T12:00:00'), 'dd/MM/yyyy') : 'SELECCIONA FECHA'}</span>
                </div>
                <input 
                  ref={dateInputRef}
                  type="date" 
                  value={specificDate}
                  onChange={(e) => {
                    if (e.target.value) {
                      setSpecificDate(e.target.value);
                      setDateFilter('especifica');
                    }
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
              </div>
            </div>
          </div>
        ) : (
          <h3 className="text-lg font-bold text-white text-center">Mis registros</h3>
        )}
        
        {profile?.role === 'admin' ? (
          <div className="space-y-3">
            {records.map(record => {
              const sellerProfile = sellers[record.sellerId];
              return (
                <div key={record.id} className="bg-zinc-900 border border-zinc-800 p-3 rounded-xl flex items-center justify-between hover:border-yellow-400/30 transition-all group overflow-hidden">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="relative group/photo shrink-0">
                      {sellerProfile?.photoUrl ? (
                        <img src={sellerProfile.photoUrl} alt={record.sellerName} className="w-10 h-10 rounded-full object-cover border border-zinc-700" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-10 h-10 bg-zinc-800 rounded-full flex items-center justify-center border border-zinc-700 text-zinc-500">
                          <UserCircle size={20} />
                        </div>
                      )}
                      <div className={cn("absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-zinc-900", record.type === 'salida' ? "bg-red-500" : "bg-green-500")} />
                    </div>
                    
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-white font-bold text-sm truncate uppercase tracking-tight">{record.sellerName}</p>
                        <span className={cn("text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest", record.type === 'salida' ? "bg-red-500/10 text-red-500" : "bg-green-500/10 text-green-500")}>
                          {record.id.slice(-4)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-zinc-500 text-[10px] font-medium font-mono uppercase truncate">{format(new Date(record.timestamp), 'HH:mm:ss')} • {format(new Date(record.timestamp), 'dd/MM/yy')}</p>
                        <span className={cn("text-[9px] font-bold uppercase", record.type === 'salida' ? "text-red-400" : "text-green-400")}>
                          {record.type === 'salida' ? 'SALIDA' : 'INGRESO'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="w-10 h-12 rounded overflow-hidden border border-zinc-800 bg-black group-hover:border-zinc-700 transition-all cursor-zoom-in relative">
                      <img src={record.imageUrl} alt="Selfie" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" referrerPolicy="no-referrer" />
                    </div>
                    <button 
                      onClick={() => {
                        const dateKey = format(new Date(record.timestamp), 'yyyy-MM-dd');
                        setSelectedRecord({
                          date: dateKey,
                          ingreso: record.type === 'ingreso' ? record : null,
                          salida: record.type === 'salida' ? record : null
                        });
                      }}
                      className="p-2 bg-zinc-800/50 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-white transition-all"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
            {records.length === 0 && (
              <div className="py-12 text-center border-2 border-dashed border-zinc-800 rounded-2xl">
                <div className="w-12 h-12 bg-zinc-900 rounded-full flex items-center justify-center mx-auto mb-3 text-zinc-700">
                  <UserX size={24} />
                </div>
                <p className="text-zinc-500 text-xs italic uppercase tracking-widest font-black">Sin asistencias</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3 max-w-md mx-auto">
            {(() => {
              const grouped = records.reduce((acc: any, record) => {
                const dateKey = format(new Date(record.timestamp), 'yyyy-MM-dd');
                if (!acc[dateKey]) acc[dateKey] = { date: dateKey, ingreso: null, salida: null };
                if (record.type === 'ingreso' && !acc[dateKey].ingreso) acc[dateKey].ingreso = record;
                if (record.type === 'salida' && !acc[dateKey].salida) acc[dateKey].salida = record;
                return acc;
              }, {});

              const sortedGroups = Object.values(grouped).sort((a: any, b: any) => b.date.localeCompare(a.date));

              if (sortedGroups.length === 0) {
                return <p className="text-center text-zinc-500 text-sm py-4">Aún no tienes registros de asistencia.</p>;
              }

              return sortedGroups.map((group: any) => (
                <div 
                  key={group.date} 
                  onClick={() => setSelectedRecord(group)}
                  className="p-4 rounded-xl border bg-zinc-900 border-zinc-800 hover:border-yellow-400/50 transition-all cursor-pointer group"
                >
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-white font-bold capitalize">{format(new Date(group.date + 'T12:00:00'), 'EEEE dd/MM', { locale: es })}</p>
                    <ChevronRight size={16} className="text-zinc-600 group-hover:text-yellow-400 group-hover:translate-x-1 transition-all" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Llegada</p>
                      <p className={cn("text-sm font-mono", group.ingreso ? "text-green-400" : "text-zinc-700")}>
                        {group.ingreso ? format(new Date(group.ingreso.timestamp), 'HH:mm') : '--:--'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Salida</p>
                      <p className={cn("text-sm font-mono", group.salida ? "text-red-400" : "text-zinc-700")}>
                        {group.salida ? format(new Date(group.salida.timestamp), 'HH:mm') : '--:--'}
                      </p>
                    </div>
                  </div>
                </div>
              ));
            })()}
          </div>
        )}
      </div>

      {/* Details Modal */}
      <AnimatePresence>
        {selectedRecord && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="w-full max-w-sm"
            >
              <Card className="relative overflow-hidden p-0">
                <div className="bg-gradient-to-br from-zinc-800 to-zinc-900 p-6 border-b border-zinc-800">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h4 className="text-lg font-bold text-white uppercase tracking-tight">Registro Detallado</h4>
                      <p className="text-zinc-400 text-sm capitalize">{format(new Date(selectedRecord.date + 'T12:00:00'), 'EEEE dd MMMM, yyyy', { locale: es })}</p>
                    </div>
                    <button onClick={() => setSelectedRecord(null)} className="p-2 bg-zinc-800 rounded-lg text-zinc-400 hover:text-white">
                      <X size={20} />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="bg-zinc-950/50 rounded-xl p-3 border border-zinc-800/50">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                        <p className="text-[10px] text-zinc-500 uppercase font-bold">Llegada</p>
                      </div>
                      <p className="text-lg font-mono text-white">
                        {selectedRecord.ingreso ? format(new Date(selectedRecord.ingreso.timestamp), 'HH:mm') : '--:--'}
                      </p>
                    </div>
                    <div className="bg-zinc-950/50 rounded-xl p-3 border border-zinc-800/50">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                        <p className="text-[10px] text-zinc-500 uppercase font-bold">Salida</p>
                      </div>
                      <p className="text-lg font-mono text-white">
                        {selectedRecord.salida ? format(new Date(selectedRecord.salida.timestamp), 'HH:mm') : '--:--'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    {selectedRecord.ingreso && (
                      <div className="space-y-2">
                        <p className="text-xs text-zinc-500 font-medium text-center">Selfie Ingreso</p>
                        <div className="aspect-[3/4] rounded-xl overflow-hidden border border-zinc-800 bg-black">
                          <img src={selectedRecord.ingreso.imageUrl} alt="Ingreso" className="w-full h-full object-cover" />
                        </div>
                      </div>
                    )}
                    {selectedRecord.salida && (
                      <div className="space-y-2">
                        <p className="text-xs text-zinc-500 font-medium text-center">Selfie Salida</p>
                        <div className="aspect-[3/4] rounded-xl overflow-hidden border border-zinc-800 bg-black">
                          <img src={selectedRecord.salida.imageUrl} alt="Salida" className="w-full h-full object-cover" />
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <Button onClick={() => setSelectedRecord(null)} className="w-full py-4 text-sm font-bold uppercase tracking-widest mt-2">
                    Cerrar
                  </Button>
                </div>
              </Card>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const Landing = ({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) => {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden bg-black">
      {/* Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] blur-[120px] rounded-full pointer-events-none bg-yellow-400/5" />
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }} 
        animate={{ opacity: 1, y: 0 }} 
        className="text-center max-w-2xl relative z-10"
      >
        <div className="w-24 h-24 bg-yellow-400 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-yellow-400/20">
          <StoreIcon className="text-black" size={48} />
        </div>
        
        <h1 className="text-3xl md:text-4xl font-black tracking-tighter mb-4 text-white">
          Tienda <span className="text-yellow-400">Goo!</span>
        </h1>
        
        <p className="text-sm md:text-base text-zinc-500 font-medium mb-8 leading-relaxed">
          Lleva el control de inventario, ventas y vendedores en un solo lugar.
        </p>
        
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <Button 
            onClick={onLogin} 
            className="py-2.5 px-8 text-sm w-[220px]"
          >
            Iniciar Sesión <ChevronRight size={18} />
          </Button>
          <Button 
            onClick={onRegister} 
            variant="secondary" 
            className="py-2.5 px-8 text-sm w-[220px] border border-zinc-800"
          >
            Crear Cuenta
          </Button>
        </div>
      </motion.div>
      
      <div className="absolute bottom-8 text-zinc-600 text-sm font-mono uppercase tracking-widest">
        Premium Store Management Platform
      </div>
    </div>
  );
};

const Auth = ({ initialMode = 'login', onBack }: { initialMode?: 'login' | 'register'; onBack: () => void }) => {
  const [isLogin, setIsLogin] = useState(initialMode === 'login');
  const [isRecover, setIsRecover] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const handleRecoverSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    const formData = new FormData(e.currentTarget);
    const email = formData.get('recoverEmail') as string;

    try {
      await sendPasswordResetEmail(auth, email.trim());
      setSuccessMessage('Se ha enviado un enlace de recuperación a tu correo electrónico. Por favor, revisa tu bandeja de entrada.');
    } catch (err: any) {
      console.error("Error setting password reset email:", err);
      if (err.code === 'auth/user-not-found') {
        setError('No existe ningún usuario registrado con este correo electrónico.');
      } else if (err.code === 'auth/invalid-email') {
        setError('El formato del correo electrónico ingresado no es válido.');
      } else if (err.code === 'auth/missing-email') {
        setError('Por favor, ingresa un correo electrónico.');
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const formData = new FormData(e.currentTarget);
    const emailOrPhone = formData.get('email') as string;
    const password = formData.get('password') as string;

    // Normalize email/phone for Auth
    let authEmail = emailOrPhone;
    if (!emailOrPhone.includes('@')) {
      // Assume it's a phone number, normalize it
      const cleanPhone = emailOrPhone.replace(/\D/g, '');
      authEmail = `${cleanPhone}@tiendagoo.com`;
    }

    if (!isLogin) {
      const confirmPassword = formData.get('confirmPassword') as string;
      if (password !== confirmPassword) {
        setError('Las contraseñas no coinciden');
        setLoading(false);
        return;
      }
    }

    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, authEmail, password);
      } else {
        const storeName = formData.get('storeName') as string;
        const ruc = formData.get('ruc') as string;
        const adminName = formData.get('adminName') as string;

        // Initialize a temporary secondary app to avoid triggering primary onAuthStateChanged before profile is ready
        const secondaryApp = initializeApp(firebaseConfig, `reg-${Date.now()}`);
        const secondaryAuth = getAuth(secondaryApp);
        const secondaryDb = getFirestore(secondaryApp, firebaseConfig.firestoreDatabaseId);

        try {
          // Create user inside secondary auth (doesn't log in primary auth)
          const userCred = await createUserWithEmailAndPassword(secondaryAuth, authEmail, password);
          
          try {
            // Check RUC uniqueness (authenticated via secondary user)
            const rucQuery = query(collection(secondaryDb, 'stores'), where('ruc', '==', ruc));
            const rucSnap = await getDocs(rucQuery);
            
            if (!rucSnap.empty) {
              // RUC already exists, cleanup the auth user and throw error
              await userCred.user.delete();
              setError('El RUC que está ingresando ya está registrado.');
              setLoading(false);
              return;
            }
            
            // Create Store using secondary db
            const storeRef = doc(collection(secondaryDb, 'stores'));
            await setDoc(storeRef, {
              name: storeName,
              ruc: ruc,
              ownerId: userCred.user.uid,
              createdAt: new Date().toISOString()
            });

            // Create User Profile using secondary db
            await setDoc(doc(secondaryDb, 'users', userCred.user.uid), {
              email: emailOrPhone,
              authEmail: authEmail,
              role: 'admin',
              storeId: storeRef.id,
              displayName: adminName,
              password: password
            });

            // Trigger automated registration/verification email template from Firebase console
            if (emailOrPhone.includes('@')) {
              try {
                await sendEmailVerification(userCred.user);
              } catch (emailErr) {
                console.error("Error sending verification email:", emailErr);
              }
            }

            // Now that all database documents are successfully created and verified, 
            // sign in on the primary Auth instance. This will trigger onAuthStateChanged
            // and find the profile document immediately!
            await signInWithEmailAndPassword(auth, authEmail, password);
          } catch (innerError: any) {
            // Cleanup the user if anything fails
            try {
              await userCred.user.delete();
            } catch (delErr) {
              console.error("Error deleting user during cleanup:", delErr);
            }
            throw innerError;
          }
        } finally {
          // Guaranteed cleanup of secondary app
          await deleteApp(secondaryApp);
        }
      }
    } catch (e: any) {
      if (e.code === 'auth/invalid-credential' || e.code === 'auth/user-not-found' || e.code === 'auth/wrong-password') {
        setError('Correo o contraseña incorrectos');
      } else if (e.code === 'auth/email-already-in-use') {
        setError('Este correo electrónico ya esta en uso.');
      } else {
        setError(e.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-black">
      {/* Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] blur-[120px] rounded-full pointer-events-none bg-yellow-400/5 text-yellow-400" />
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }} 
        animate={{ opacity: 1, y: 0 }} 
        className="w-full max-w-md relative z-10"
      >
        <div className="flex items-center justify-center gap-3 mb-8">
          <h1 className="text-4xl font-black tracking-tight text-white">Tienda Goo!</h1>
          <div className="w-10 h-10 bg-yellow-400 rounded-xl flex items-center justify-center shadow-lg shadow-yellow-400/20">
            <StoreIcon className="text-black" size={24} />
          </div>
        </div>

        <Card className="bg-zinc-900/80 backdrop-blur-xl border-zinc-800 shadow-2xl">
          {isRecover ? (
            <form onSubmit={handleRecoverSubmit} className="space-y-4">
              <div className="text-center mb-6">
                <h3 className="text-xl font-bold text-white mb-2">Recuperar Contraseña</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  Ingresa tu correo electrónico registrado y te enviaremos un enlace para restablecer tu contraseña.
                </p>
              </div>

              <div>
                <label className="text-sm text-zinc-400 mb-1 block">Correo Electrónico</label>
                <Input name="recoverEmail" type="email" placeholder="ejemplo@correo.com" required />
              </div>

              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-red-500 text-sm">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}

              {successMessage && (
                <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg flex items-center gap-2 text-green-400 text-sm">
                  <CheckCircle2 size={16} className="shrink-0" />
                  <span className="leading-tight">{successMessage}</span>
                </div>
              )}

              <Button type="submit" className="w-full py-3 text-lg" disabled={loading}>
                {loading ? 'Enviando...' : 'Enviar Enlace de Recuperación'}
              </Button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsRecover(false);
                    setError(null);
                    setSuccessMessage(null);
                  }}
                  className="text-zinc-400 hover:text-yellow-400 text-sm transition-colors"
                >
                  Volver a Iniciar Sesión
                </button>
              </div>
            </form>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                {!isLogin && (
                  <>
                    <div>
                      <label className="text-sm text-zinc-400 mb-1 block">Nombres y Apellidos</label>
                      <Input name="adminName" required />
                    </div>
                    <div>
                      <label className="text-sm text-zinc-400 mb-1 block">Nombre de la Tienda</label>
                      <Input name="storeName" required />
                    </div>
                    <div>
                      <label className="text-sm text-zinc-400 mb-1 block">RUC</label>
                      <Input name="ruc" required />
                    </div>
                  </>
                )}
                <div>
                  <label className="text-sm text-zinc-400 mb-1 block">Correo Electrónico / Teléfono</label>
                  <Input name="email" type="text" required />
                </div>
                <div>
                  <label className="text-sm text-zinc-400 mb-1 block">Contraseña</label>
                  <div className="relative">
                    <Input 
                      name="password" 
                      type={showPassword ? 'text' : 'password'} 
                      placeholder="••••••••" 
                      required 
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {isLogin && (
                    <div className="flex justify-end mt-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setIsRecover(true);
                          setError(null);
                          setSuccessMessage(null);
                        }}
                        className="text-xs text-yellow-400/80 hover:text-yellow-400 transition-colors"
                      >
                        ¿Olvidaste tu contraseña?
                      </button>
                    </div>
                  )}
                </div>

                {!isLogin && (
                  <div>
                    <label className="text-sm text-zinc-400 mb-1 block">Confirmar Contraseña</label>
                    <div className="relative">
                      <Input 
                        name="confirmPassword" 
                        type={showPassword ? 'text' : 'password'} 
                        placeholder="••••••••" 
                        required 
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-red-500 text-sm">
                    <AlertCircle size={16} />
                    {error}
                  </div>
                )}

                <Button type="submit" className="w-full py-3 text-lg" disabled={loading}>
                  {loading ? 'Procesando...' : isLogin ? 'Iniciar Sesión' : 'Crear Cuenta'}
                </Button>
              </form>

              <div className="mt-6 text-center space-y-4">
                <button 
                  onClick={() => {
                    setIsLogin(!isLogin);
                    setError(null);
                    setSuccessMessage(null);
                  }}
                  className="text-zinc-400 hover:text-yellow-400 text-sm transition-colors block w-full"
                >
                  {isLogin ? '¿No tienes cuenta? Regístrate aquí' : '¿Ya tienes cuenta? Inicia sesión'}
                </button>
                <button 
                  onClick={onBack}
                  className="hidden md:block text-zinc-600 hover:text-zinc-400 text-xs uppercase tracking-widest transition-colors w-full text-center"
                >
                  Volver al inicio
                </button>
              </div>
            </>
          )}
        </Card>
      </motion.div>
    </div>
  );
};

// --- Selfie Registration for First Time Sellers ---
const SelfieRegistration = ({ profile, onRegistrationSuccess }: { 
  profile: UserProfile; 
  onRegistrationSuccess: (photoUrl: string) => void;
}) => {
  const [isCapturing, setIsCapturing] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const startCamera = async () => {
    setIsCapturing(true);
    setImageSrc(null);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.error("Error accessing camera:", err);
      setError("No se pudo acceder a la cámara. Intenta con la opción de subir una foto de tus archivos.");
      setIsCapturing(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
    setIsCapturing(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        const width = videoRef.current.videoWidth;
        const height = videoRef.current.videoHeight;
        canvasRef.current.width = width;
        canvasRef.current.height = height;
        
        // Mirror horizontally on capture
        context.translate(width, 0);
        context.scale(-1, 1);
        
        context.drawImage(videoRef.current, 0, 0, width, height);
        
        // Reset transformation state
        context.setTransform(1, 0, 0, 1, 0, 0);
        
        const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.82);
        setImageSrc(dataUrl);
        stopCamera();
      }
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        setError("El archivo es demasiado grande (máximo 10MB).");
        return;
      }
      try {
        const reader = new FileReader();
        reader.onloadend = () => {
          setImageSrc(reader.result as string);
          setIsCapturing(false);
          setError(null);
          stopCamera();
        };
        reader.readAsDataURL(file);
      } catch (err) {
        setError("Error al cargar la foto seleccionada.");
      }
    }
  };

  const handleRegister = async () => {
    if (!profile || !imageSrc) return;
    setLoading(true);
    setError(null);
    try {
      const storagePath = `profiles/${profile.uid}/selfie_${Date.now()}.jpg`;
      const photoUrl = await uploadImage(imageSrc, storagePath);
      
      await updateDoc(doc(db, 'users', profile.uid), {
        photoUrl: photoUrl,
        selfieRegistered: true
      });
      
      onRegistrationSuccess(photoUrl);
    } catch (e: any) {
      console.error(e);
      setError("Error al guardar la foto de perfil en el servidor.");
    } finally {
      setLoading(false);
    }
  };

  // Automatically start camera on mount
  useEffect(() => {
    startCamera();
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-black text-white">
      <Card className="w-full max-w-md p-8 border text-center shadow-2xl relative overflow-hidden bg-zinc-950 border-zinc-900 text-white">
        {/* Subtle Background Accent */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-yellow-400" />

        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 bg-yellow-400/10 rounded-2xl flex items-center justify-center mb-4 border border-yellow-400/20 text-yellow-400">
            <Camera size={28} />
          </div>
          <h2 className="text-[20px] font-bold tracking-tight">Registro de Selfie Obligatorio</h2>
          <p className="text-xs mt-2 max-w-sm text-zinc-400">
            Hola {profile.displayName || profile.email}. Debes registrar tu selfie por primera vez para validar tu identidad y completar tu perfil.
          </p>
        </div>

        {error && (
          <div className="p-3 mb-4 rounded-xl text-xs bg-red-500/10 text-red-500 border border-red-500/20 text-left">
            {error}
          </div>
        )}

        <div className="relative aspect-video rounded-2xl overflow-hidden bg-zinc-900/40 border border-zinc-800 mb-6 flex items-center justify-center">
          {isCapturing ? (
            <>
              <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover scale-x-[-1]" />
              <div className="absolute inset-0 border-2 border-yellow-400/30 rounded-2xl pointer-events-none flex items-center justify-center">
                {/* Silhouette or guide circle */}
                <div className="w-48 h-48 rounded-full border-2 border-dashed border-yellow-400/30 animate-pulse" />
              </div>
            </>
          ) : imageSrc ? (
            <img src={imageSrc} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div className="flex flex-col items-center gap-3 p-4">
              <UserCircle size={48} className="text-zinc-600 animate-pulse" />
              <p className="text-xs text-zinc-500">Cámara inactiva o sin permisos.</p>
              <div className="flex flex-col gap-2 w-full max-w-[240px]">
                <Button onClick={startCamera} variant="secondary" size="xs">
                  Reactivar Cámara
                </Button>
                <span className="text-[10px] text-zinc-600 uppercase tracking-widest font-semibold">o</span>
                <Button onClick={() => fileInputRef.current?.click()} variant="outline" size="xs" className="border-zinc-800 text-zinc-400 hover:bg-zinc-900 flex items-center gap-1.5 justify-center">
                  <Upload size={12} /> Subir foto desde dispositivo
                </Button>
              </div>
            </div>
          )}
        </div>

        <canvas ref={canvasRef} className="hidden" />
        <input 
          ref={fileInputRef} 
          type="file" 
          accept="image/*" 
          className="hidden" 
          onChange={handleFileChange} 
        />

        <div className="flex gap-3">
          {isCapturing ? (
            <Button onClick={capturePhoto} className="w-full py-3 font-semibold shadow-lg shadow-yellow-400/10 text-black bg-yellow-400 hover:bg-yellow-500">
              Tomar Foto
            </Button>
          ) : imageSrc ? (
            <>
              <Button onClick={startCamera} variant="secondary" className="flex-1" disabled={loading}>
                Tomar Otra
              </Button>
              <Button onClick={handleRegister} className="flex-1 text-black bg-yellow-400 hover:bg-yellow-500 shadow-lg shadow-yellow-400/10" disabled={loading}>
                {loading ? 'Guardando...' : 'Guardar foto'}
              </Button>
            </>
          ) : (
            <div className="flex gap-2 w-full">
              <Button onClick={startCamera} className="flex-1 py-3 font-semibold text-black bg-yellow-400 hover:bg-yellow-500 shadow-lg shadow-yellow-400/10">
                Iniciar Cámara
              </Button>
              <Button onClick={() => fileInputRef.current?.click()} variant="secondary" className="flex-1 py-3 font-semibold text-white bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 flex items-center justify-center gap-1.5">
                <Upload size={16} /> Subir Foto
              </Button>
            </div>
          )}
        </div>

        <div className="mt-6 pt-4 border-t border-zinc-900/50 flex justify-center">
          <button 
            onClick={() => signOut(auth)} 
            className="text-xs text-zinc-500 hover:text-red-500 transition-colors uppercase tracking-wider flex items-center gap-1.5"
          >
            <LogOut size={14} /> Salir o cambiar cuenta
          </button>
        </div>
      </Card>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [authState, setAuthState] = useState<AuthContextType>({ user: null, profile: null, store: null, loading: true, error: null });
  const [activeTab, setActiveTab] = useState<'dashboard' | 'inventory' | 'pos' | 'users' | 'profile' | 'asistencia' | 'finanzas'>(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    const validTabs = ['dashboard', 'inventory', 'pos', 'users', 'profile', 'asistencia', 'finanzas'];
    return (validTabs.includes(tab || '') ? tab : 'dashboard') as any;
  });

  const handleTabChange = (tabId: typeof activeTab) => {
    if (tabId === activeTab) return;
    setActiveTab(tabId);
    window.history.pushState({ tab: tabId }, '', `?tab=${tabId}`);
  };

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const params = new URLSearchParams(window.location.search);
      
      // Update Tab
      if (params.has('tab')) {
        const tab = params.get('tab');
        const validTabs = ['dashboard', 'inventory', 'pos', 'users', 'profile', 'asistencia'];
        if (validTabs.includes(tab || '')) {
          setActiveTab(tab as any);
        }
      } else {
        setActiveTab('dashboard');
      }

      // Update Unauth View
      if (params.has('uv')) {
        const uv = params.get('uv');
        const validUnauth = ['landing', 'login', 'register'];
        if (validUnauth.includes(uv || '')) {
          setUnauthView(uv as any);
        }
      } else if (!params.has('tab')) {
        setUnauthView('landing');
      }
    };
    
    window.addEventListener('popstate', handlePopState);
    
    if (!window.history.state) {
      window.history.replaceState({ tab: activeTab, uv: unauthView }, '', window.location.search || `?tab=${activeTab}`);
    }

    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const [unauthView, setUnauthView] = useState<'landing' | 'login' | 'register'>(() => {
    const params = new URLSearchParams(window.location.search);
    const uv = params.get('uv');
    const valid = ['landing', 'login', 'register'];
    return (valid.includes(uv || '') ? uv : 'landing') as any;
  });

  const handleUnauthViewChange = (newView: typeof unauthView) => {
    if (newView === unauthView) return;
    setUnauthView(newView);
    const params = new URLSearchParams(window.location.search);
    params.set('uv', newView);
    window.history.pushState({ uv: newView }, '', `?${params.toString()}`);
  };

  const [cart, setCart] = useState<{ product: Product; quantity: number }[]>([]);

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) return prev;
        return prev.map(item => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.product.id !== productId));
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.product.id === productId) {
        const newQty = Math.max(1, item.quantity + delta);
        if (newQty > item.product.stock) return item;
        return { ...item, quantity: newQty };
      }
      return item;
    }));
  };

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (user) {
        // Real-time snapshot listener ensures that as soon as the client finishes setDoc for the user record,
        // this triggers and loads the profile, avoiding any race conditions on registration or updates.
        unsubscribeProfile = onSnapshot(doc(db, 'users', user.uid), async (userDoc) => {
          if (userDoc.exists()) {
            try {
              const profile = { uid: user.uid, ...userDoc.data() } as UserProfile;
              const storeDoc = await getDoc(doc(db, 'stores', profile.storeId));
              const store = storeDoc.exists() ? { id: storeDoc.id, ...storeDoc.data() } as Store : null;
              setAuthState({ user, profile, store, loading: false, error: null });
            } catch (e: any) {
              setAuthState({ user, profile: null, store: null, loading: false, error: e.message });
            }
          } else {
            // Keep user auth active, profile waits till written
            setAuthState({ user, profile: null, store: null, loading: false, error: 'Perfil no encontrado' });
          }
        }, (error) => {
          setAuthState({ user, profile: null, store: null, loading: false, error: error.message });
        });
      } else {
        setAuthState({ user: null, profile: null, store: null, loading: false, error: null });
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  if (authState.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="w-12 h-12 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const navItems = [
    { id: 'dashboard', label: 'INICIO', icon: LayoutDashboard },
    { id: 'inventory', label: 'PRODUCTOS', icon: Package },
    { id: 'pos', label: 'VENTAS', icon: ShoppingCart },
    { id: 'asistencia', label: 'ASISTENCIA', icon: ClipboardCheck },
    ...(authState.profile?.role === 'admin' ? [
      { id: 'finanzas', label: 'GASTOS/EGRESOS', icon: DollarSign }
    ] : []),
  ];

  const renderContent = () => {
    if (!authState.user) {
      return (
        <AnimatePresence mode="wait">
          {unauthView === 'landing' ? (
            <motion.div
              key="landing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <Landing 
                onLogin={() => handleUnauthViewChange('login')} 
                onRegister={() => handleUnauthViewChange('register')} 
              />
            </motion.div>
          ) : (
            <motion.div
              key="auth"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <Auth 
                initialMode={unauthView === 'login' ? 'login' : 'register'} 
                onBack={() => handleUnauthViewChange('landing')} 
              />
            </motion.div>
          )}
        </AnimatePresence>
      );
    }

    const isFirstTimeUser = !authState.profile?.selfieRegistered;
    
    if (isFirstTimeUser && authState.profile) {
      return (
        <SelfieRegistration 
          profile={authState.profile} 
          onRegistrationSuccess={(photoUrl) => {
            setAuthState(prev => {
              if (prev.profile) {
                return {
                  ...prev,
                  profile: {
                    ...prev.profile,
                    photoUrl,
                    selfieRegistered: true
                  }
                };
              }
              return prev;
            });
          }}
        />
      );
    }

    return (
      <div className="min-h-screen flex flex-col md:flex-row bg-black text-zinc-300">
        <NotificationListener />
        {/* Sidebar - Hidden on mobile */}
        <aside className="hidden md:flex w-56 border-r border-zinc-800 flex-col p-4 fixed h-full z-20 bg-black">
          <div className="flex items-center gap-2 mb-6 px-2">
            <div className="w-8 h-8 bg-yellow-400 rounded-lg flex items-center justify-center shadow-lg shadow-yellow-400/20">
              <StoreIcon className="text-black" size={20} />
            </div>
            <h1 className="text-lg font-bold tracking-tight text-white">Tienda Goo!</h1>
          </div>

          <nav className="flex-1 space-y-1">
            {navItems.map(item => (
              <button
                key={item.id}
                onClick={() => handleTabChange(item.id as any)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all group text-sm",
                  activeTab === item.id 
                    ? "bg-yellow-400 text-black font-bold shadow-lg shadow-yellow-400/10" 
                    : "text-zinc-500 hover:text-white hover:bg-zinc-900"
                )}
              >
                <item.icon size={20} />
                {item.label}
                {item.id === 'pos' && cart.length > 0 && (
                  <span className="ml-auto bg-black text-yellow-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center border border-yellow-400/20">
                    {cart.reduce((sum, item) => sum + item.quantity, 0)}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="pt-4 border-t border-zinc-800 text-sm">
            <div className="flex flex-col gap-2 mb-4">
              <button 
                onClick={() => handleTabChange('profile')}
                className={cn(
                  "flex items-center gap-3 p-2 rounded-lg border transition-all w-full text-left group relative",
                  activeTab === 'profile' 
                    ? "bg-yellow-400 border-yellow-400 shadow-lg shadow-yellow-400/10" 
                    : "bg-zinc-900/50 border-zinc-800 hover:border-zinc-700"
                )}
              >
                <div className={cn(
                  "w-8 h-8 rounded-full border overflow-hidden flex items-center justify-center shrink-0",
                  activeTab === 'profile' ? "border-black/20 bg-black/10" : "border-zinc-700 bg-zinc-800 text-yellow-400"
                )}>
                  {authState.profile?.photoUrl ? (
                    <img src={authState.profile.photoUrl} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <UserCircle size={20} className={activeTab === 'profile' ? "text-black" : "text-yellow-400"} />
                  )}
                </div>
                <div className="overflow-hidden flex-1">
                  <p className={cn("text-xs font-bold truncate", activeTab === 'profile' ? "text-black" : "text-white")}>
                    {authState.profile?.displayName || 'Mi Perfil'}
                  </p>
                  <p className={cn("text-[9px] uppercase tracking-widest font-medium", activeTab === 'profile' ? "text-black/60" : "text-zinc-500")}>
                    {authState.profile?.role === 'admin' ? 'Administrador' : 'Vendedor'}
                  </p>
                </div>
                <div className={cn(
                  "p-1.5 rounded-md transition-colors",
                  activeTab === 'profile' ? "bg-black/10 text-black" : "text-zinc-500 group-hover:text-white"
                )}>
                  <Settings size={16} />
                </div>
              </button>
            </div>
            <button 
              onClick={() => signOut(auth)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-zinc-500 hover:text-red-500 hover:bg-red-500/5 transition-all uppercase text-[10px] tracking-wider"
            >
              <LogOut size={18} />
              Cerrar Sesión
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 md:ml-56 p-4 md:p-6 pb-24 md:pb-6">
          {activeTab !== 'profile' && (
            <header className={cn(
            "flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4 text-sm",
            (activeTab === 'inventory' || activeTab === 'users') ? "mb-0" : "mb-6 md:mb-8"
          )}>
              <div className="flex justify-between items-end w-full md:w-auto">
                <div className="flex-1 pr-4 h-[42.9835px]">
                  <h2 className="text-[20px] leading-tight font-bold tracking-tight text-white">
                    {navItems.find(i => i.id === activeTab)?.label}
                  </h2>
                  <p className="text-zinc-500 text-[13px] w-[271.667px] max-w-full mt-2 leading-[12px]">{authState.store?.name} • RUC: {authState.store?.ruc}</p>
                </div>
                <div className="md:hidden pl-4 border-l border-zinc-800 flex flex-col justify-end">
                  <button 
                    onClick={() => handleTabChange('profile')}
                    className="flex flex-col items-center gap-1.5 flex-shrink-0 text-yellow-400"
                  >
                    <div className={cn(
                      "rounded-full border overflow-hidden flex items-center justify-center bg-zinc-900 border-zinc-800",
                      authState.profile?.photoUrl ? "w-8 h-8" : "p-1.5 w-8 h-8"
                    )}>
                      {authState.profile?.photoUrl ? (
                        <img 
                          src={authState.profile.photoUrl} 
                          alt="Profile" 
                          className="w-full h-full object-cover" 
                          referrerPolicy="no-referrer" 
                        />
                      ) : (
                        <UserCircle size={20} />
                      )}
                    </div>
                    <span className="text-[10px] font-medium leading-none uppercase">PERFIL</span>
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-4 w-full md:w-auto">
                {/* SUNAT status indicator removed */}
              </div>
            </header>
          )}

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === 'dashboard' && <Dashboard />}
              {activeTab === 'inventory' && <Inventory onAddToCart={addToCart} />}
              {activeTab === 'pos' && (
                <POS 
                  cart={cart} 
                  setCart={setCart} 
                  addToCart={addToCart} 
                  removeFromCart={removeFromCart} 
                  updateQuantity={updateQuantity} 
                />
              )}
              {activeTab === 'asistencia' && <Asistencia />}
              {activeTab === 'profile' && <ProfileView />}
              {activeTab === 'users' && <UserManagement />}
              {activeTab === 'finanzas' && authState.profile?.role === 'admin' && <Finanzas />}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Mobile Bottom Navigation */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 backdrop-blur-xl border-t px-4 py-3 flex items-center justify-around z-50 bg-zinc-900/90 border-zinc-800">
          {navItems.filter(item => item.id !== 'profile').map(item => (
            <button
              key={item.id}
              onClick={() => handleTabChange(item.id as any)}
              className={cn(
                "flex flex-col items-center gap-1 transition-all active:scale-90 relative",
                activeTab === item.id ? "text-yellow-400" : "text-zinc-500"
              )}
            >
              <item.icon size={24} />
              {item.id === 'pos' && cart.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-yellow-400 text-black text-[9px] font-bold px-1 py-0.5 rounded-full min-w-[16px] text-center shadow-lg">
                  {cart.reduce((sum, item) => sum + item.quantity, 0)}
                </span>
              )}
              <span className="text-[10px] font-medium uppercase">{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
    );
  };

  return (
    <AuthContext.Provider value={{ ...authState }}>
      {renderContent()}
    </AuthContext.Provider>
  );
}
