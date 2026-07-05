import { io, Socket } from 'socket.io-client';
import { API_URL } from './Config';

/**
 * Shared Socket.io client — used by CustomerDisplayContent to receive
 * customer_display_sync events from the Railway backend.
 *
 * Works identically on Android (React Native) and web (Electron BrowserWindow
 * via React Native Web + socket.io-client).
 */
export const socket: Socket = io(API_URL, {
  transports: ['polling', 'websocket'], // Start with polling, upgrade to websocket
  reconnectionAttempts: 20,
  reconnectionDelay: 1500,
  reconnectionDelayMax: 5000,
  timeout: 10000,
  autoConnect: true,
  forceNew: false,
});

socket.on('connect', () => {
  console.log('🔌 [CustomerDisplay] Socket connected:', socket.id);
});

socket.on('connect_error', (error) => {
  console.error('🔌 [CustomerDisplay] Socket connection error:', error);
});
