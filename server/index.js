import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './authRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

// Middleware
app.use(cors({
  origin: CLIENT_URL,
  credentials: true,
}));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║  JATI Auth Server running on port ${PORT}   ║
║  Client URL: ${CLIENT_URL.padEnd(27)}║
╚══════════════════════════════════════════╝
  `);
});
