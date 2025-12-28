require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = 'test-secret-key';
let users = [
  {
    id: '1',
    email: 'admin@vynce.com',
    password: 'Password', // password
    firstName: 'Admin',
    lastName: 'User',
    company: 'Vynce Inc',
    role: 'admin',
    subscription: { plan: 'professional', status: 'active' }
  }
];

// Health endpoint
app.get("/api/health", (req, res) => {
  res.json({ 
    success: true, 
    message: "Test server is running",
    timestamp: new Date().toISOString()
  });
});

// Register endpoint
app.post("/api/auth/register", async (req, res) => {
  console.log('📝 Registration attempt:', req.body);
  
  const { email, password, firstName, lastName, company } = req.body;

  if (!email || !password || !firstName || !lastName) {
    return res.status(400).json({ success: false, message: 'All fields required' });
  }

  const existingUser = users.find(u => u.email === email);
  if (existingUser) {
    return res.status(400).json({ success: false, message: 'User exists' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: uuidv4(),
      email,
      password: hashedPassword,
      firstName,
      lastName,
      company: company || `${firstName}'s Company`,
      role: 'user',
      subscription: { plan: 'starter', status: 'trial' }
    };

    users.push(newUser);

    const token = jwt.sign({ userId: newUser.id, email: newUser.email }, JWT_SECRET);
    
    res.status(201).json({
      success: true,
      message: 'User registered',
      user: {
        id: newUser.id,
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        company: newUser.company,
        subscription: newUser.subscription
      },
      token
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Login endpoint
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  const user = users.find(u => u.email === email);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET);

  res.json({
    success: true,
    message: 'Login successful',
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      company: user.company,
      subscription: user.subscription
    },
    token
  });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Test server running on port ${PORT}`);
  console.log(`📍 http://localhost:${PORT}/api/health`);
});