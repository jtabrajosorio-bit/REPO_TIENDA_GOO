export type UserRole = 'admin' | 'seller';

export interface Store {
  id: string;
  name: string;
  ownerId: string;
  ruc: string;
  address?: string;
  createdAt: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  storeId: string;
  displayName?: string;
  password?: string;
  photoUrl?: string;
  selfieRegistered?: boolean;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  price: number;
  stock: number;
  category?: string;
  storeId: string;
  material?: string;
  provider?: string;
  imageUrl?: string;
}

export interface SaleItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
}

export interface Sale {
  id: string;
  total: number;
  items: SaleItem[];
  timestamp: string;
  storeId: string;
  sellerId: string;
  sellerName?: string;
  documentType: 'boleta' | 'factura';
  buyerName?: string;
  buyerDni?: string;
}

export interface AttendanceRecord {
  id: string;
  storeId: string;
  sellerId: string;
  sellerName: string;
  timestamp: string;
  imageUrl: string;
  type: 'ingreso' | 'salida';
}

export interface Expense {
  id: string;
  amount: number;
  item: string;
  quantity: number;
  supplier: string;
  imageUrl?: string;
  storeId: string;
  createdBy: string;
  createdAt: string;
}

export interface AISettings {
  id?: string;
  storeId: string;
  isActive: boolean;
  whatsappPhoneId?: string;
  whatsappToken?: string;
  verifyToken?: string;
  personality?: string;
  welcomeMessage?: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: string;
}

export interface WhatsAppChat {
  id: string;
  storeId: string;
  customerPhone: string;
  customerName?: string;
  lastMessage: string;
  lastTimestamp: string;
  status: 'open' | 'closed' | 'human_needed';
  messages: ChatMessage[];
}
