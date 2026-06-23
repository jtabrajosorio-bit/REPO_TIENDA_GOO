import React, { useState, useEffect, useRef, useContext } from 'react';
import { db, auth } from '../firebase';
import { uploadImage, AuthContext } from '../App';
import { Expense } from '../types';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  deleteDoc, 
  doc 
} from 'firebase/firestore';
import { 
  DollarSign, 
  FileText, 
  Camera, 
  Upload, 
  Search, 
  Trash2, 
  Plus, 
  X, 
  Loader2, 
  ArrowLeft, 
  CheckCircle, 
  AlertCircle, 
  Eye, 
  Sparkles,
  ShoppingBag,
  TrendingDown,
  UserCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export const Finanzas = () => {
  const { store, profile } = useContext(AuthContext);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Registration Form State
  const [showForm, setShowForm] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [receiptImage, setReceiptImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  
  // Extracted/Form Fields
  const [amount, setAmount] = useState<string>('');
  const [item, setItem] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [supplier, setSupplier] = useState<string>('');
  
  // UI helpers
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch store expenses
  useEffect(() => {
    if (!store?.id) return;
    setLoading(true);

    const q = query(
      collection(db, 'expenses'),
      where('storeId', '==', store.id),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const expensesList: Expense[] = [];
      snapshot.forEach((doc) => {
        expensesList.push({ id: doc.id, ...doc.data() } as Expense);
      });
      setExpenses(expensesList);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching expenses:", error);
      setNotification({
        message: "No tienes permisos o hubo un error al cargar los registros de gastos.",
        type: 'error'
      });
      setLoading(false);
    });

    return () => unsubscribe();
  }, [store?.id]);

  // Handle Notifications timeout
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Clean camera tracks
  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
    setIsCapturing(false);
  };

  // Start built-in camera
  const startCamera = async () => {
    setIsCapturing(true);
    setReceiptImage(null);
    setCameraError(null);
    setAnalysisError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } // Prefer back camera (environment) for receipts
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      // Fallback try with basic
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (backupErr) {
        setCameraError(
          "No se pudo acceder a la cámara. Por favor, selecciona la opción 'Subir Foto desde dispositivo'."
        );
        setIsCapturing(false);
      }
    }
  };

  // Capture snapshot
  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        const width = videoRef.current.videoWidth;
        const height = videoRef.current.videoHeight;
        canvasRef.current.width = width;
        canvasRef.current.height = height;
        
        // No mirror for receipts since we want to read the text correctly
        context.drawImage(videoRef.current, 0, 0, width, height);
        
        const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.85);
        setReceiptImage(dataUrl);
        stopCamera();
        analyzeReceiptWithGemini(dataUrl);
      }
    }
  };

  // Handle file uploads
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 12 * 1024 * 1024) {
        setNotification({ message: "El archivo excede el tamaño máximo de 12MB.", type: 'error' });
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        setReceiptImage(dataUrl);
        analyzeReceiptWithGemini(dataUrl);
      };
      reader.readAsDataURL(file);
    }
  };

  // Call backend proxy for Gemini analysis
  const analyzeReceiptWithGemini = async (base64Image: string) => {
    setIsAnalyzing(true);
    setAnalysisError(null);
    
    // Reset values first
    setAmount('');
    setItem('');
    setQuantity(1);
    setSupplier('');

    try {
      const response = await fetch('/api/gemini/analyze-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image })
      });

      if (!response.ok) {
        throw new Error("El servicio de IA no devolvió un resultado válido.");
      }

      const data = await response.json();
      
      // Populate fields
      if (data.monto) setAmount(String(data.monto));
      if (data.item) setItem(data.item);
      if (data.cantidad) setQuantity(Number(data.cantidad) || 1);
      if (data.proveedor) setSupplier(data.proveedor);

    } catch (err: any) {
      console.error("Error analyzing receipt:", err);
      setAnalysisError("No pudimos analizar el comprobante automáticamente. Por favor completa los datos de manera manual.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Reset form and states
  const resetForm = () => {
    stopCamera();
    setShowForm(false);
    setReceiptImage(null);
    setIsAnalyzing(false);
    setAnalysisError(null);
    setAmount('');
    setItem('');
    setQuantity(1);
    setSupplier('');
  };

  // Save full expense data
  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!store?.id || !profile) return;

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setNotification({ message: "Por favor ingresa un monto válido.", type: 'error' });
      return;
    }
    if (!item.trim()) {
      setNotification({ message: "Por favor ingresa la descripción o ítem.", type: 'error' });
      return;
    }
    if (!supplier.trim()) {
      setNotification({ message: "Por favor provee el nombre del negocio o proveedor.", type: 'error' });
      return;
    }

    setSaving(true);

    try {
      let finalImageUrl = "";

      // 1. Upload receipt to storage if it exists
      if (receiptImage) {
        const path = `products/${store.id}/expense_${Date.now()}.jpg`;
        finalImageUrl = await uploadImage(receiptImage, path);
      }

      // 2. Add expense document to Firestore
      const expenseData = {
        amount: Number(amount),
        item: item.trim(),
        quantity: Number(quantity) || 1,
        supplier: supplier.trim(),
        imageUrl: finalImageUrl,
        storeId: store.id,
        createdBy: profile.displayName || profile.email,
        createdAt: new Date().toISOString()
      };

      await addDoc(collection(db, 'expenses'), expenseData);
      
      setNotification({ message: "Egreso registrado correctamente.", type: 'success' });
      resetForm();
    } catch (err) {
      console.error("Error saving expense:", err);
      setNotification({ message: "Error al guardar el egreso. Verifica tus permisos.", type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // Delete expense
  const handleDeleteExpense = async (id: string) => {
    if (!window.confirm("¿Estás seguro de eliminar este registro de gasto?")) return;
    try {
      await deleteDoc(doc(db, 'expenses', id));
      setNotification({ message: "Egreso eliminado permanentemente.", type: 'success' });
    } catch (err) {
      console.error("Error deleting expense:", err);
      setNotification({ message: "Error al eliminar el registro. No tienes permisos.", type: 'error' });
    }
  };

  // Financial Summaries
  const totalAmount = expenses.reduce((sum, exp) => sum + exp.amount, 0);
  const expenseCount = expenses.length;
  const uniqueSuppliers = new Set(expenses.map(e => e.supplier.toLowerCase())).size;

  // Filter list
  const filteredExpenses = expenses.filter(exp => 
    exp.item.toLowerCase().includes(searchQuery.toLowerCase()) ||
    exp.supplier.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-8" id="finanzas-module">
      {/* Notifications banner */}
      <AnimatePresence>
        {notification && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-4 right-4 z-50 p-4 rounded-xl flex items-center gap-3 shadow-2xl border ${
              notification.type === 'success' 
                ? 'bg-zinc-900 border-emerald-500 text-emerald-400' 
                : 'bg-zinc-900 border-red-500/50 text-red-400'
            }`}
          >
            {notification.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
            <span className="text-sm font-medium">{notification.message}</span>
            <button onClick={() => setNotification(null)} className="ml-2 hover:bg-zinc-800 p-1 rounded-lg">
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Panel views */}
      {!showForm ? (
        <>
          {/* Header section with Stats Card */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="hidden">
              {/* Contenido eliminado a petición del usuario */}
            </div>
            <Button onClick={() => setShowForm(true)} className="bg-yellow-400 text-black hover:bg-yellow-500 font-bold flex items-center gap-2">
              <Plus size={18} /> Registrar Egreso con IA
            </Button>
          </div>

          {/* Bento Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-2xl flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
                <TrendingDown size={20} />
              </div>
              <div>
                <span className="text-zinc-500 text-[10px] font-medium uppercase tracking-wider block">Total Egresado</span>
                <span className="text-lg font-bold text-white font-mono">S/ {totalAmount.toFixed(2)}</span>
              </div>
            </div>

            <div className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-2xl flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-yellow-400/10 border border-yellow-400/20 flex items-center justify-center text-yellow-500">
                <FileText size={20} />
              </div>
              <div>
                <span className="text-zinc-500 text-[10px] font-medium uppercase tracking-wider block">Transacciones</span>
                <span className="text-lg font-bold text-white font-mono">{expenseCount}</span>
              </div>
            </div>

            <div className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-2xl flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                <ShoppingBag size={20} />
              </div>
              <div>
                <span className="text-zinc-500 text-[10px] font-medium uppercase tracking-wider block">Proveedores</span>
                <span className="text-lg font-bold text-white font-mono">{uniqueSuppliers}</span>
              </div>
            </div>
          </div>

          {/* Search bar & Live Listing */}
          <div className="bg-zinc-950 border border-zinc-900 rounded-2xl overflow-hidden shadow-xl p-4 sm:p-6 space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4">
              <h4 className="text-sm font-semibold tracking-wide text-zinc-400 uppercase">Detalle de Egresos Recientes</h4>
              
              <div className="relative max-w-sm w-full">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
                <input 
                  type="text" 
                  placeholder="Buscar por artículo o proveedor..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2 pl-10 pr-4 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-yellow-400"
                />
              </div>
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 size={32} className="text-yellow-400 animate-spin" />
                <p className="text-xs text-zinc-500">Cargando registros de gastos...</p>
              </div>
            ) : filteredExpenses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-zinc-800 rounded-xl bg-zinc-900/10">
                <DollarSign size={40} className="text-zinc-600 mb-3 animate-pulse" />
                <p className="text-sm font-medium text-zinc-400">Sin egresos registrados</p>
                <p className="text-xs text-zinc-600 mt-1 max-w-xs">{searchQuery ? 'Modifica los filtros de búsqueda e inténtalo de nuevo.' : 'No se han registrado salidas monetarias. Presiona el botón "+ Registrar Egreso" arriba.'}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[700px]">
                  <thead>
                    <tr className="border-b border-zinc-900 text-zinc-500 text-[11px] tracking-wider uppercase font-semibold">
                      <th className="pb-3 pl-4">Fecha</th>
                      <th className="pb-3">Proveedor / Tienda</th>
                      <th className="pb-3">Ítem / Concepto</th>
                      <th className="pb-3 text-center">Cant.</th>
                      <th className="pb-3 text-right">Monto</th>
                      <th className="pb-3 text-center">Boleta / Foto</th>
                      <th className="pb-3 pr-4 text-center">Eliminar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredExpenses.map((expense) => (
                      <tr 
                        key={expense.id} 
                        className="border-b border-zinc-900 hover:bg-zinc-900/30 transition-all text-xs text-zinc-300"
                      >
                        <td className="py-4 pl-4 font-mono text-zinc-500">
                          {new Date(expense.createdAt).toLocaleDateString('es-PE', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </td>
                        <td className="py-4 font-medium text-white max-w-[150px] truncate">
                          {expense.supplier}
                        </td>
                        <td className="py-4 text-zinc-400 max-w-[200px] truncate">
                          {expense.item}
                        </td>
                        <td className="py-4 text-center font-mono">
                          {expense.quantity}
                        </td>
                        <td className="py-4 text-right font-mono font-bold text-red-400">
                          S/ {expense.amount.toFixed(2)}
                        </td>
                        <td className="py-4">
                          <div className="flex justify-center">
                            {expense.imageUrl ? (
                              <button 
                                onClick={() => setEnlargedImage(expense.imageUrl || null)}
                                className="relative group w-8 h-8 rounded border border-zinc-800 overflow-hidden flex items-center justify-center hover:border-yellow-400 transition-all bg-zinc-900"
                              >
                                <img src={expense.imageUrl} alt="Boleta" className="w-full h-full object-cover group-hover:opacity-40 transition-all" />
                                <Eye size={12} className="absolute inset-0 m-auto opacity-0 group-hover:opacity-100 text-yellow-400 transition-all pointer-events-none" />
                              </button>
                            ) : (
                              <span className="text-[10px] text-zinc-700 font-mono">Sin foto</span>
                            )}
                          </div>
                        </td>
                        <td className="py-4 text-center pr-4">
                          <button 
                            onClick={() => handleDeleteExpense(expense.id)}
                            className="p-1.5 rounded-lg border border-zinc-800 text-zinc-500 hover:text-red-400 hover:bg-red-500/5 hover:border-red-500/20 transition-all"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        /* Form Registration Panel with Camera Capture & AI */
        <div className="bg-zinc-950 border border-zinc-900 rounded-3xl p-6 sm:p-8 shadow-2xl max-w-4xl mx-auto space-y-6">
          <div className="flex items-center justify-between border-b border-zinc-950 pb-4">
            <button 
              onClick={resetForm}
              className="flex items-center gap-2 text-zinc-500 hover:text-white transition-all text-xs uppercase tracking-wider"
            >
              <ArrowLeft size={16} /> Volver a Lista
            </button>
            <div className="flex items-center gap-1.5 text-xs text-yellow-400 font-semibold bg-yellow-400/5 px-3 py-1.5 rounded-full border border-yellow-400/10">
              <Sparkles size={14} /> Procesamiento Inteligente
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Left side: Image Capture / Media inputs */}
            <div className="space-y-4">
              <div className="bg-zinc-900/35 border border-zinc-800 rounded-2xl overflow-hidden aspect-[4/5] flex flex-col justify-center items-center relative">
                
                {isCapturing ? (
                  <>
                    <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                    <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-3 px-4">
                      <Button onClick={stopCamera} variant="secondary" size="sm" className="bg-zinc-900/90 text-white border-zinc-800">
                        Cancelar
                      </Button>
                      <Button onClick={capturePhoto} className="bg-yellow-400 text-black font-semibold hover:bg-yellow-500" size="sm">
                        Capturar Boleta
                      </Button>
                    </div>
                  </>
                ) : receiptImage ? (
                  <>
                    <img src={receiptImage} alt="Receipt Preview" className="w-full h-full object-cover" />
                    <button 
                      onClick={() => setReceiptImage(null)}
                      className="absolute top-3 right-3 p-1.5 bg-black/60 hover:bg-black rounded-full border border-zinc-800 text-white transition-all shadow-lg"
                    >
                      <X size={16} />
                    </button>
                    {isAnalyzing && (
                      <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center p-6 text-center space-y-4 backdrop-blur-sm">
                        <Loader2 className="text-yellow-400 animate-spin" size={36} />
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-white animate-pulse">Analizando comprobante...</p>
                          <p className="text-[11px] text-zinc-500">Nuestra IA está extrayendo los importes y datos del proveedor.</p>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="p-6 text-center flex flex-col items-center gap-4">
                    <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500">
                      <FileText size={32} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">Sube o toma una foto de la boleta de compra</p>
                      <p className="text-xs text-zinc-600 mt-1 max-w-[240px] mx-auto">Soporta boletas, facturas, tickets de taxi o de pago a proveedores.</p>
                    </div>

                    <div className="flex flex-col gap-2 w-full max-w-[200px] mt-2">
                      <Button onClick={startCamera} className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 py-2.5 flex items-center justify-center gap-2 text-xs">
                        <Camera size={14} className="text-yellow-400" /> Tomar Foto con Cámara
                      </Button>
                      <span className="text-[10px] text-zinc-700 tracking-wider font-semibold uppercase">O</span>
                      <Button onClick={() => fileInputRef.current?.click()} variant="outline" className="border-zinc-800 hover:bg-zinc-900 py-2.5 flex items-center justify-center gap-2 text-xs text-zinc-400">
                        <Upload size={14} /> Subir Archivo
                      </Button>
                    </div>
                  </div>
                )}

                <canvas ref={canvasRef} className="hidden" />
                <input 
                  type="file" 
                  ref={fileInputRef}
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden" 
                />
              </div>

              {cameraError && (
                <div className="bg-red-500/5 border border-red-500/10 p-3 rounded-xl flex items-start gap-2.5 text-red-400 text-xs text-left">
                  <AlertCircle size={14} className="mt-0.5" />
                  <span>{cameraError}</span>
                </div>
              )}
            </div>

            {/* Right side: Verification form fields */}
            <div>
              <form onSubmit={handleSaveExpense} className="space-y-5 text-left">
                <div className="border-b border-zinc-900 pb-2">
                  <h4 className="text-sm font-semibold text-white">Datos Extraídos del Gasto</h4>
                  <p className="text-[11px] text-zinc-500">Verifica los datos detectados por la IA antes de guardarlo en caja.</p>
                </div>

                {analysisError && (
                  <div className="bg-yellow-400/5 border border-yellow-400/10 p-3 rounded-xl flex items-start gap-2 text-yellow-500/90 text-xs leading-relaxed">
                    <Sparkles size={14} className="mt-0.5 flex-shrink-0" />
                    <span>{analysisError}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4">
                  {/* Amount / Monto */}
                  <div>
                    <label className="text-xs font-semibold text-zinc-500 block mb-1.5">Monto Total (S/.) *</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 font-bold font-mono text-xs">S/</span>
                      <input 
                        type="number" 
                        step="0.01"
                        placeholder="0.00"
                        required
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 pl-8 pr-4 text-xs font-mono font-bold text-white focus:outline-none focus:border-yellow-400"
                        disabled={isAnalyzing}
                      />
                    </div>
                  </div>

                  {/* Supplier / Proveedor */}
                  <div>
                    <label className="text-xs font-semibold text-zinc-500 block mb-1.5">Proveedor / Negocio *</label>
                    <input 
                      type="text" 
                      placeholder="Ej. Distribuidora Gómez, Yape a Taxista, Compras Metro..."
                      required
                      value={supplier}
                      onChange={(e) => setSupplier(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 text-xs text-white focus:outline-none focus:border-yellow-400"
                      disabled={isAnalyzing}
                    />
                  </div>

                  {/* Detalle / Ítem */}
                  <div>
                    <label className="text-xs font-semibold text-zinc-500 block mb-1.5">Artículo / Concepto de Gasto *</label>
                    <input 
                      type="text" 
                      placeholder="Ej. Saco de arroz 50kg, Empaque de bolsas, Pago de luz..."
                      required
                      value={item}
                      onChange={(e) => setItem(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 text-xs text-white focus:outline-none focus:border-yellow-400"
                      disabled={isAnalyzing}
                    />
                  </div>

                  {/* Cantidad / Quantity */}
                  <div>
                    <label className="text-xs font-semibold text-zinc-500 block mb-1.5">Cantidad</label>
                    <input 
                      type="number" 
                      min="1"
                      required
                      value={quantity}
                      onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 text-xs text-white focus:outline-none focus:border-yellow-400 font-mono"
                      disabled={isAnalyzing}
                    />
                  </div>
                </div>

                <div className="pt-4 flex gap-3">
                  <Button 
                    type="button" 
                    variant="secondary" 
                    onClick={resetForm} 
                    className="flex-1 bg-zinc-900 text-zinc-400 border border-zinc-800 hover:bg-zinc-800 py-3"
                  >
                    Salir
                  </Button>
                  <Button 
                    type="submit" 
                    className="flex-1 bg-yellow-400 text-black hover:bg-yellow-500 font-bold py-3 text-xs shadow-lg shadow-yellow-400/10 flex items-center justify-center gap-2"
                    disabled={saving || isAnalyzing}
                  >
                    {saving ? (
                      <>
                        <Loader2 size={16} className="animate-spin" /> Guardando...
                      </>
                    ) : (
                      'Confirmar e Registrar'
                    )}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Enlarged Image view modal */}
      <AnimatePresence>
        {enlargedImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setEnlargedImage(null)}
            className="fixed inset-0 bg-black/95 z-[100] flex items-center justify-center p-4 backdrop-blur-md cursor-zoom-out"
          >
            <button 
              onClick={() => setEnlargedImage(null)}
              className="absolute top-4 right-4 p-2 bg-zinc-900 border border-zinc-800 rounded-full text-white hover:bg-zinc-800 transition-all"
            >
              <X size={20} />
            </button>
            <img 
              src={enlargedImage} 
              alt="Comprobante de Pago" 
              className="max-h-[90vh] max-w-[95vw] rounded-2xl shadow-2xl object-contain border border-zinc-800"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// Internal minimal Button implementation since shaded UI may not have standard button exports
interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'outline';
  size?: 'xs' | 'sm' | 'md';
  children: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
}

const Button = ({ variant = 'primary', size = 'md', className, children, ...props }: ButtonProps) => {
  return (
    <button
      className={`
        rounded-xl font-medium transition-all duration-250 active:scale-95 disabled:opacity-50 disabled:pointer-events-none cursor-pointer
        ${size === 'xs' ? 'px-2 py-1 text-[9px]' : size === 'sm' ? 'px-2.5 py-1 text-[10px]' : 'px-4 py-2 text-[11px]'}
        ${variant === 'primary' ? 'bg-yellow-400 text-black shadow-md border hover:border-yellow-500 border-yellow-400 shadow-yellow-400/5' : 
          variant === 'outline' ? 'bg-black text-zinc-300 border border-zinc-800 hover:bg-zinc-900/50 hover:text-white' : 
          'bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white'}
        ${className}
      `}
      {...props}
    >
      {children}
    </button>
  );
};
