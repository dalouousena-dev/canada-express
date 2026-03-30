const express = require('express');
const { sequelize } = require('./db');
const cors = require('cors');
const dotenv = require('dotenv');
const { seedPlans, seedContent } = require('./utils/seed');

dotenv.config();

const app = express();

// Middleware
const CLIENT_URL = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
const corsOptions = {
  origin: CLIENT_URL,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());

// Postgres (Sequelize) Connection
sequelize.authenticate()
  .then(async () => {
    console.log('✓ Postgres connected via Sequelize');
    await sequelize.sync();
    if (process.env.SEED_DB === 'true') {
      await seedPlans();
      await seedContent();
    }
  })
  .catch(err => console.log('Postgres connection error:', err));

// Routes
app.use('/api/plans', require('./routes/plans'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/content', require('./routes/content'));
app.use('/api/payment', require('./routes/payment'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✓ Server running on port ${PORT}`);
});
