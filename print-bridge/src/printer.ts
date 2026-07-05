import * as net from 'net';
import { logger } from './logger';

/**
 * Parses tags like [C], [L], [R], <B>, </B>, <font size='big'> to ESC/POS binary buffers.
 */
function parseFormatting(content: string): Buffer {
  const chunks: Buffer[] = [];
  
  // Tag translation regex
  const tagRegex = /(\[C\]|\[L\]|\[R\]|<\/?B>|<font size='big'>|<font size='normal'>|<\/font>)/gi;
  const parts = content.split(tagRegex);
  
  for (const part of parts) {
    if (!part) continue;
    const lower = part.toLowerCase();
    if (lower === '[c]') {
      chunks.push(Buffer.from([0x1B, 0x61, 0x01])); // Align center
    } else if (lower === '[l]') {
      chunks.push(Buffer.from([0x1B, 0x61, 0x00])); // Align left
    } else if (lower === '[r]') {
      chunks.push(Buffer.from([0x1B, 0x61, 0x02])); // Align right
    } else if (lower === '<b>') {
      chunks.push(Buffer.from([0x1B, 0x45, 0x01])); // Bold on
    } else if (lower === '</b>') {
      chunks.push(Buffer.from([0x1B, 0x45, 0x00])); // Bold off
    } else if (lower === "<font size='big'>" || lower === "<font size=\"big\">") {
      chunks.push(Buffer.from([0x1D, 0x21, 0x11])); // Double width + double height
    } else if (lower === "<font size='normal'>" || lower === "<font size=\"normal\">" || lower === '</font>') {
      chunks.push(Buffer.from([0x1D, 0x21, 0x00])); // Reset font size
    } else {
      chunks.push(Buffer.from(part, 'utf-8'));
    }
  }
  
  // Append line feeds and paper cut command (GS V 66 0)
  chunks.push(Buffer.from([0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x42, 0x00]));
  
  return Buffer.concat(chunks);
}

/**
 * Verifies that the destination printer is reachable using a short TCP connection check.
 * Checks the actual ESC/POS port (9100) with a 750ms timeout. Returns true if reachable, false otherwise.
 * Does not throw exceptions for expected offline printers.
 */
export function checkPrinterReachable(ip: string, port: number = 9100, timeoutMs: number = 750): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    socket.setTimeout(timeoutMs);

    socket.connect(port, ip, () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(true);
      }
    });

    socket.on('error', () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(false);
      }
    });

    socket.on('timeout', () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(false);
      }
    });
  });
}

/**
 * Sends a raw data payload to a LAN/Wi-Fi thermal printer using a TCP socket connection.
 * Supports both base64 binary encoding and standard UTF-8 string encoding with tag translation.
 */
export async function sendToPrinter(ip: string, port: number, content: string, jobId: string | number): Promise<void> {
  const checkStart = Date.now();
  const isReachable = await checkPrinterReachable(ip, port, 750);
  const latency = Date.now() - checkStart;

  if (!isReachable) {
    console.log(`\n[Printer Check]\nIP: ${ip}\nPort: ${port}\nReachable: NO\nReason: Timeout\n\n[Print]\nStatus: FAILED\nError: Printer unreachable\n`);
    throw new Error('Printer unreachable');
  }

  console.log(`\n[Printer Check]\nIP: ${ip}\nPort: ${port}\nReachable: YES\nLatency: ${latency}ms\n`);

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const client = new net.Socket();
    const timeoutVal = 30000;

    client.setTimeout(timeoutVal);

    let payload: Buffer;
    
    // Quick heuristic to check if content is base64 encoded binary
    const trimmed = content.trim();
    const isBase64 = /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && (trimmed.length % 4 === 0);

    if (isBase64) {
      payload = Buffer.from(trimmed, 'base64');
    } else {
      payload = parseFormatting(content);
    }

    console.log(`\n[Print]\nStarted...\n`);

    client.connect(port, ip, () => {
      client.write(payload, () => {
        client.end();
      });
    });

    client.on('close', () => {
      const duration = Date.now() - startTime;
      console.log(`Completed\nDuration: ${duration}ms\nStatus: COMPLETED\n`);
      resolve();
    });

    client.on('error', (err: any) => {
      client.destroy();
      console.log(`Status: FAILED\nError: ${err.message || 'TCP Socket Connection Failed'}\n`);
      reject(err);
    });

    client.on('timeout', () => {
      client.destroy();
      console.log(`Status: FAILED\nError: Connection timed out\n`);
      reject(new Error(`Connection to printer timed out`));
    });
  });
}
