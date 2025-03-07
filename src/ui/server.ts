// src/ui/server.ts
import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { UiServerOptions, UiServer, StatusUpdate } from '../types.js';

/**
 * Starts a web UI server for monitoring the TDD-AI process
 * @param options - UI server options
 * @returns Promise with server control handlers
 */
export async function startUiServer(options: UiServerOptions): Promise<UiServer> {
  const { port, projectPath } = options;

  // Create Express app
  const app = express();
  const server = http.createServer(app);
  const io = new SocketIOServer(server);

  // Serve static frontend files if they exist
  const staticPath = path.join(process.cwd(), 'client', 'build');
  app.use(express.static(staticPath));

  // API routes
  app.get('/api/status', (req, res) => {
    res.json({
      status: 'running',
      projectPath,
    });
  });

  // Socket.io event handlers
  io.on('connection', (socket) => {
    console.log('Client connected to UI');

    socket.on('disconnect', () => {
      console.log('Client disconnected from UI');
    });
  });

  // Start server
  await new Promise<void>((resolve) => {
    server.listen(port, () => {
      console.log(`UI server listening on port ${port}`);
      resolve();
    });
  });

  // Update broadcast method
  const broadcastUpdate = (update: StatusUpdate): void => {
    io.emit('status-update', update);
  };

  // Cleanup function
  return {
    stop: async (): Promise<void> => {
      return new Promise<void>((resolve) => {
        server.close(() => {
          console.log('UI server stopped');
          resolve();
        });
      });
    },
    // Pass this to the orchestrator's onUpdate
    // broadcastUpdate,
  };
}