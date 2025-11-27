// -------------------------------------------
//  DEPENDENCIES
// -------------------------------------------
require("dotenv").config()
const fs = require("fs")
const http = require("http")
const express = require("express")
const bodyParser = require("body-parser")
const socketio = require("socket.io")
const cors = require("cors")
const multer = require("multer")
const csv = require("csv-parser")
const { Vonage } = require("@vonage/server-sdk")

// ADD THESE ONCE - NOT TWICE:
const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")
const { v4: uuidv4 } = require("uuid")

// -------------------------------------------
//  UPLOADS DIRECTORY SETUP
// -------------------------------------------
const uploadDir = "uploads/"
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}
console.log(`📁 Uploads directory ready: ${uploadDir}`)

// -------------------------------------------
//  EXPRESS & MIDDLEWARE
// -------------------------------------------
const app = express()
app.use(cors({ origin: "*" })) // allow all origins during dev
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: false }))
app.set("view engine", "ejs")
app.set("views", __dirname + "/views")

// -------------------------------------------
//  VONAGE CLIENT
// -------------------------------------------
const privateKey = fs.readFileSync(process.env.VONAGE_PRIVATE_KEY_PATH)
const vonage = new Vonage({
  applicationId: process.env.VONAGE_APPLICATION_ID,
  privateKey: privateKey,
})

const callerId = process.env.VONAGE_PHONE_NUMBER
const forwardTo = process.env.FORWARD_TO_NUMBER

// in‑memory call list
let allCalls = []
let bulkCallQueue = []
let isBulkCallRunning = false
let currentBulkJob = null



// -------------------------------------------
//  SOCKET.IO SETUP
// -------------------------------------------
const server = http.createServer(app)
const io = socketio(server, { cors: { origin: "*" } })

io.on("connection", (socket) => {
  console.log("📡 Dashboard connected")
  // Send current bulk call status to newly connected client
  socket.emit("bulkCallStatus", { 
    isRunning: isBulkCallRunning, 
    queueLength: bulkCallQueue.length,
    currentJob: currentBulkJob
  })
   socket.emit("callUpdate", allCalls);
     // Listen for call status requests
  socket.on("requestCallStatus", (callId) => {
    const call = allCalls.find(c => c.uuid === callId);
    if (call) {
      socket.emit("callStatusUpdate", call);
    }
  });
});
// -------------------------------------------

function broadcastCallUpdate(entry) {
  io.emit("callUpdate", entry)
}

function broadcastBulkCallStatus() {
  io.emit("bulkCallStatus", { 
    isRunning: isBulkCallRunning, 
    queueLength: bulkCallQueue.length,
    currentJob: currentBulkJob
  })
}

function broadcastBulkProgress(progress) {
  io.emit("bulkProgress", progress)
}

// -------------------------------------------
//  OUTBOUND CALL LOGIC
// -------------------------------------------
async function initiateCall(toNumber, metadata = {}) {
  try {
    // First, create a "dialing" entry
    const dialingEntry = { 
      number: toNumber, 
      uuid: `dialing-${Date.now()}`, // Temporary UUID until we get real one
      status: "dialing", 
      createdAt: new Date(),
      ...metadata,
      type: 'bulk'
    };
    allCalls.push(dialingEntry);
    broadcastCallUpdate(dialingEntry);

    console.log(`📞 Dialing ${toNumber}...`);
    
    const response = await vonage.voice.createOutboundCall({
      to: [{ type: "phone", number: toNumber }],
      from: { type: "phone", number: callerId },
      answer_url: ["https://cuddly-ideas-throw.loca.lt/voice"],
      event_url: ["https://cuddly-ideas-throw.loca.lt/status"],
    });

    const uuid = response.uuid || (response.calls && response.calls[0].uuid);
    
    // Update the entry with real UUID and status
    const realEntry = { 
      number: toNumber, 
      uuid, 
      status: "initiated", 
      createdAt: new Date(),
      ...metadata,
      type: 'bulk'
    };
    
    // Replace the dialing entry with the real one
    const dialingIndex = allCalls.findIndex(call => call.uuid === dialingEntry.uuid);
    if (dialingIndex !== -1) {
      allCalls[dialingIndex] = realEntry;
    } else {
      allCalls.push(realEntry);
    }
    
    broadcastCallUpdate(realEntry);
    console.log(`✅ Dialed ${toNumber}, Call UUID: ${uuid}`);
    return realEntry;
  } catch (err) {
    console.error(`❌ Error dialing ${toNumber}:`, err.message);
    
    // Update the dialing entry to show failure
    const failedCall = allCalls.find(call => 
      call.number === toNumber && call.status === "dialing"
    );
    if (failedCall) {
      failedCall.status = "failed";
      failedCall.error = err.message;
      broadcastCallUpdate(failedCall);
    }
    
    throw err;
  }
}
// -------------------------------------------
//  BULK CALL PROCESSING
// -------------------------------------------
async function processBulkCallQueue() {
  if (isBulkCallRunning || bulkCallQueue.length === 0) return
  
  isBulkCallRunning = true
  currentBulkJob = {
    id: Date.now().toString(),
    total: bulkCallQueue.length,
    processed: 0,
    startedAt: new Date(),
    fileName: bulkCallQueue[0]?.metadata?.source || 'bulk_call.csv'
  }
  
  broadcastBulkCallStatus()
  console.log(`🚀 Starting bulk call process with ${bulkCallQueue.length} numbers`)
  
  let successCount = 0
  let failCount = 0
  
  for (let i = 0; i < bulkCallQueue.length; i++) {
    if (!isBulkCallRunning) break // Allow stopping
    
    const callData = bulkCallQueue[i]
    
    try {
      await initiateCall(callData.number, callData.metadata)
      successCount++
      
      // Update progress
      currentBulkJob.processed = i + 1
      broadcastBulkProgress({
        current: i + 1,
        total: bulkCallQueue.length,
        success: successCount,
        failed: failCount,
        currentNumber: callData.number,
        jobId: currentBulkJob.id
      })
      
      // Delay between calls (2 seconds to avoid rate limits)
      await new Promise(resolve => setTimeout(resolve, 2000))
      
    } catch (err) {
      console.error(`Failed to call ${callData.number}:`, err.message)
      failCount++
      
      // Still update progress but mark as failed
      currentBulkJob.processed = i + 1
      broadcastBulkProgress({
        current: i + 1,
        total: bulkCallQueue.length,
        success: successCount,
        failed: failCount,
        currentNumber: callData.number,
        jobId: currentBulkJob.id,
        error: err.message
      })
    }
  }
  
  // Completion
  console.log(`✅ Bulk call process completed: ${successCount} successful, ${failCount} failed`)
  io.emit("bulkComplete", {
    jobId: currentBulkJob.id,
    success: successCount,
    failed: failCount,
    total: bulkCallQueue.length
  })
  
  // Reset state
  bulkCallQueue = []
  isBulkCallRunning = false
  currentBulkJob = null
  broadcastBulkCallStatus()
}

// -------------------------------------------
//  CORE ROUTES
// -------------------------------------------
app.get("/", (req, res) => res.render("index", { calls: allCalls }))

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Vynce API is running",
    timestamp: new Date().toISOString(),
    users: users.length,
    endpoints: {
      register: "POST /api/auth/register",
      login: "POST /api/auth/login",
      profile: "GET /api/auth/me",
      plans: "GET /api/subscription/plans"
    }
  });
});

// User registration endpoint
app.post("/api/auth/register", async (req, res) => {
  console.log('📝 Registration attempt received');
  
  const { email, password, firstName, lastName, company, plan = 'starter' } = req.body;

  console.log('Registration data:', { email, firstName, lastName, company, plan });

  if (!email || !password || !firstName || !lastName) {
    return res.status(400).json({ 
      success: false, 
      message: 'All fields are required' 
    });
  }

  // Check if user already exists
  const existingUser = users.find(u => u.email === email);
  if (existingUser) {
    return res.status(400).json({ 
      success: false, 
      message: 'User already exists with this email' 
    });
  }

  try {
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user with subscription
    const newUser = {
      id: uuidv4(),
      email,
      password: hashedPassword,
      firstName,
      lastName,
      company: company || `${firstName}'s Company`,
      role: 'user',
      subscription: {
        plan,
        status: 'trial', // 14-day trial
        monthlyPrice: subscriptionPlans[plan].monthlyPrice,
        setupFee: subscriptionPlans[plan].setupFee,
        billingCycle: 'monthly',
        trialEnds: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        nextBillingDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        maxCalls: subscriptionPlans[plan].maxCalls,
        usedCalls: 0,
        features: subscriptionPlans[plan].features
      },
      createdAt: new Date(),
      lastLogin: new Date()
    };

    users.push(newUser);
    console.log(`✅ New user registered: ${newUser.email}`);

    // Generate JWT token
    const token = jwt.sign(
      { userId: newUser.id, email: newUser.email, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: {
        id: newUser.id,
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        company: newUser.company,
        role: newUser.role,
        subscription: newUser.subscription
      },
      token
    });

  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error during registration' 
    });
  }
});
// Subscription Plans (public, mock Stripe)
app.get('/api/subscription/plans', (req, res) => {
  res.json({
    success: true,
    plans: {
      trial: {
        id: 'trial',
        name: 'Free Trial',
        price: 0,
        features: ['100 Calls', 'CSV Upload', 'Basic VM'],
        maxCalls: 100
      },
      basic: {
        id: 'basic',
        name: 'Basic',
        price: 29,
        features: ['1K Calls/mo', 'Notes', 'Scheduling'],
        maxCalls: 1000
      },
      pro: {
        id: 'pro',
        name: 'Pro',
        price: 49,
        features: ['Unlimited Calls', 'Team Access', 'Custom Scripts'],
        maxCalls: Infinity
      }
    }
  });
});
// -------------------------------------------
//  AUTH MIDDLEWARE (PASTE AT LINE ~370-380)
// -------------------------------------------
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '') || req.cookies?.token;
    
    if (!token) {
      return res.status(401).json({ success: false, message: 'Access denied. Please login.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    req.user = user; // Attach user to request
    next();
  } catch (error) {
    console.error('🔒 Auth error:', error.message);
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// NOW your routes can use authMiddleware:
app.get('/api/me', authMiddleware, async (req, res) => {
  // ... rest of code
});

// User Profile (/api/me - update subscription)
app.get('/api/me', authMiddleware, async (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user._id,
      email: req.user.email,
      name: req.user.name,
      roles: req.user.roles || ['user'],
      subscription: req.user.subscription || { plan: 'trial', maxCalls: 100, usedCalls: 0 }
    }
  });
});

// User login endpoint
app.post("/api/auth/login", async (req, res) => {
  console.log('🔐 Login attempt received');
  
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ 
      success: false, 
      message: 'Email and password required' 
    });
  }

  try {
    const user = users.find(u => u.email === email);
    if (!user) {
      console.log('❌ User not found:', email);
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    // Check password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      console.log('❌ Invalid password for:', email);
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    // Update last login
    user.lastLogin = new Date();

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log(`✅ User logged in: ${user.email}`);

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        company: user.company,
        role: user.role,
        subscription: user.subscription
      },
      token
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error during login' 
    });
  }
});

// Get current user profile
app.get("/api/auth/me", (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Access token required' 
    });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ 
        success: false, 
        message: 'Invalid or expired token' 
      });
    }

    const user = users.find(u => u.id === decoded.userId);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        company: user.company,
        role: user.role,
        subscription: user.subscription,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      }
    });
  });
});

// Get subscription plans
app.get("/api/subscription/plans", (req, res) => {
  res.json({
    success: true,
    plans: subscriptionPlans
  });
});

app.get("/api/calls", (req, res) => res.json(allCalls))

app.post("/api/make-call", async (req, res) => {
  const to = req.body.to
  if (!to) return res.status(400).json({ success: false, message: "Missing number" })
  try {
    const entry = await initiateCall(to)
    res.json({ success: true, data: entry })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

app.get("/voice", (req, res) => {
  const ncco = [
    { action: "talk", text: "Connecting you to our representative..." },
    { action: "connect", from: callerId, endpoint: [{ type: "phone", number: forwardTo }] },
  ]
  res.json(ncco)
})

app.post("/status", (req, res) => {
  const { uuid, conversation_uuid, to, status, direction } = req.body;
  console.log(`ℹ️ Call status update: ${uuid} to ${to} -> ${status}`);
  
  let callUuid = uuid || conversation_uuid;
  const match = allCalls.find((c) => c.uuid === callUuid);
  
  if (match) {
    match.status = status;
    match.updatedAt = new Date();
    broadcastCallUpdate(match);
    
    // If call is completed/ended, you might want to auto-close the modal
    if (['completed', 'ended', 'failed', 'busy'].includes(status)) {
      io.emit("callEnded", { uuid: callUuid, status });
    }

    // Map Vonage status to more user-friendly statuses
    const statusMap = {
      'started': 'ringing',
      'ringing': 'ringing', 
      'answered': 'answered',
      'completed': 'completed',
      'busy': 'busy',
      'failed': 'failed',
      'rejected': 'rejected',
      'timeout': 'timeout',
      'cancelled': 'cancelled'
    };
    
    match.userStatus = statusMap[status] || status;
    broadcastCallUpdate(match);
  } else {
    console.log('⚠️ Call not found for status update:', callUuid);
  }
  
  res.sendStatus(200);
});
// -------------------------------------------
//  SIMPLE END CALL - MARK AS ENDED LOCALLY
// -------------------------------------------
app.post("/api/end-call", async (req, res) => {
  const { uuid } = req.body;
  console.log('🛑 End call request for UUID:', uuid);
  
  if (!uuid) {
    return res.status(400).json({ 
      success: false, 
      message: "Missing call UUID" 
    });
  }

  try {
    const call = allCalls.find((c) => c.uuid === uuid);
    if (!call) {
      return res.status(404).json({ 
        success: false, 
        message: "Call not found" 
      });
    }

    console.log(`🛑 Marking call ${uuid} to ${call.number} as ended`);
    
    // Simply update the call status in our system
    call.status = "ended";
    call.endedAt = new Date();
    call.endedBy = "admin";
    call.endReason = "manually_ended_by_user";
    
    broadcastCallUpdate(call);
    console.log(`✅ Call ${uuid} marked as ended in system`);
    
    res.json({ 
      success: true, 
      message: `Call to ${call.number} has been ended`,
      call: call
    });
    
  } catch (err) {
    console.error("❌ Error ending call:", err);
    res.status(500).json({ 
      success: false, 
      message: "Error ending call: " + err.message 
    });
  }
});
// -------------------------------------------
//  BULK CALL MANAGEMENT ENDPOINTS
// -------------------------------------------
app.get("/api/bulk-status", (req, res) => {
  res.json({
    isRunning: isBulkCallRunning,
    queueLength: bulkCallQueue.length,
    currentJob: currentBulkJob,
    totalCalls: allCalls.length
  })
})

app.post("/api/stop-bulk-calls", (req, res) => {
  isBulkCallRunning = false
  bulkCallQueue = []
  currentBulkJob = null
  broadcastBulkCallStatus()
  console.log("🛑 Bulk calls stopped by admin")
  res.json({ success: true, message: "Bulk calls stopped" })
})

// -------------------------------------------
//  CSV UPLOAD / BULK CALLS
// -------------------------------------------
// -------------------------------------------
//  CSV UPLOAD / BULK CALLS - FIXED PARSING
// -------------------------------------------
const upload = multer({ 
  dest: uploadDir,
  limits: { 
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1 
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.toLowerCase().endsWith('.csv')) {
      cb(null, true)
    } else {
      cb(new Error('Only CSV files are allowed'), false)
    }
  }
})

app.post("/api/upload-csv", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No file uploaded" });
  }

  const path = req.file.path;
  const numbers = [];

  console.log(`📄 Processing CSV file: ${req.file.originalname}`);

  fs.createReadStream(path)
    .pipe(csv())
    .on("data", (row) => {
      console.log('📝 Raw row data:', row); // Debug log
      
      // More flexible column name detection
      const phoneFields = ['number', 'phone', 'telephone', 'contact', 'mobile', 'phonenumber'];
      let phoneNumber = null;
      let phoneFieldName = null;
      
      // Find the first field that contains a phone number
      for (const field of phoneFields) {
        if (row[field] && row[field].toString().trim()) {
          phoneNumber = row[field].toString().trim();
          phoneFieldName = field;
          break;
        }
      }
      
      // If no standard field found, try to find any field that looks like a phone number
      if (!phoneNumber) {
        for (const [key, value] of Object.entries(row)) {
          if (value && value.toString().trim()) {
            const potentialNumber = value.toString().trim();
            // Check if it looks like a phone number (has at least 7 digits)
            const digitCount = (potentialNumber.match(/\d/g) || []).length;
            if (digitCount >= 7) {
              phoneNumber = potentialNumber;
              phoneFieldName = key;
              break;
            }
          }
        }
      }
      
      if (phoneNumber) {
        // Clean the phone number - remove all non-digit characters except leading +
        let cleanNumber = phoneNumber.replace(/[^\d+]/g, '');
        
        // Remove dots and other special characters that might be in the number
        cleanNumber = cleanNumber.replace(/\./g, ''); // Remove periods
        
        console.log(`🔍 Found phone: "${phoneNumber}" -> cleaned: "${cleanNumber}"`);
        
        // More flexible validation - accept numbers with 7+ digits
        if (cleanNumber.length >= 7) {
          // Ensure US format if it's 10 digits without country code
          if (cleanNumber.length === 10 && !cleanNumber.startsWith('+')) {
            cleanNumber = '1' + cleanNumber; // Add US country code
          }
          
          // Add + if it's an international number without it
          if (cleanNumber.length >= 11 && !cleanNumber.startsWith('+')) {
            cleanNumber = '+' + cleanNumber;
          }
          
          numbers.push({
            number: cleanNumber,
            metadata: {
              name: row.name || row.fullname || row.contact || `Contact ${numbers.length + 1}`,
              email: row.email || '',
              company: row.company || '',
              source: req.file.originalname,
              originalNumber: phoneNumber, // Keep original for reference
              sourceField: phoneFieldName
            }
          });
          
          console.log(`✅ Added number: ${cleanNumber} (from ${phoneFieldName})`);
        } else {
          console.log(`❌ Invalid number length: ${cleanNumber} (${cleanNumber.length} digits)`);
        }
      } else {
        console.log('❌ No phone number found in row:', row);
      }
    })
    .on("end", async () => {
      // Clean up uploaded file
      try {
        fs.unlinkSync(path);
      } catch (err) {
        console.log("Warning: Could not delete temp file", err);
      }
      
      console.log(`✅ CSV parsing complete: ${numbers.length} valid numbers found`);
      console.log('📋 Numbers to call:', numbers.map(n => n.number));
      
      if (numbers.length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: "No valid phone numbers found in CSV file. Please check the format." 
        });
      }
      
      // Add to bulk call queue
      bulkCallQueue.push(...numbers);
      broadcastBulkCallStatus();
      
      // Start processing if not already running
      processBulkCallQueue();
      
      // Send proper JSON response
      res.json({ 
        success: true, 
        count: numbers.length,
        message: `${numbers.length} numbers added to call queue and started processing`,
        numbers: numbers.map(n => n.number) // Include numbers for debugging
      });
    })
    .on("error", (err) => {
      // Clean up on error
      try {
        if (fs.existsSync(path)) {
          fs.unlinkSync(path);
        }
      } catch (unlinkErr) {
        console.log("Warning: Could not delete temp file", unlinkErr);
      }
      
      console.error("CSV processing error:", err);
      res.status(500).json({ 
        success: false, 
        message: "Error processing CSV file: " + err.message 
      });
    });
});
// Add this to your server code after the middleware setup

// -------------------------------------------
//  TEST ENDPOINTS
// -------------------------------------------
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "OK", 
    message: "Vynce Server is running",
    timestamp: new Date().toISOString(),
    endpoints: {
      health: "GET /api/health",
      uploadCSV: "POST /api/upload-csv", 
      makeCall: "POST /api/make-call",
      getCalls: "GET /api/calls",
      bulkStatus: "GET /api/bulk-status"
    }
  })
})

app.get("/api/test-upload", (req, res) => {
  res.json({ 
    success: true, 
    message: "Upload endpoint is accessible",
    testData: {
      numbers: ["+15551234567", "+15557654321"],
      count: 2
    }
  })
})

// -------------------------------------------
//  SCHEDULING ENDPOINT (OPTIONAL)
// -------------------------------------------
let pendingJobs = [];

app.post("/api/schedule-csv", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

  const path = req.file.path;
  const scheduledAt = req.body.scheduledAt ? new Date(req.body.scheduledAt) : null;
  const numbers = [];

  fs.createReadStream(path)
    .pipe(csv())
    .on("data", (row) => {
      const number = row.number || row.phone || row.telephone || row.contact || row.mobile
      if (number) {
        const cleanNumber = number.toString().trim().replace(/\D/g, '')
        if (cleanNumber.length >= 10) {
          numbers.push({
            number: cleanNumber,
            metadata: {
              name: row.name || row.fullname || '',
              email: row.email || '',
              company: row.company || '',
              source: req.file.originalname
            }
          })
        }
      }
    })
    .on("end", () => {
      try {
        fs.unlinkSync(path);
      } catch (err) {
        console.log("Warning: Could not delete temp file", err)
      }

      const job = {
        id: Date.now().toString(),
        filename: req.file.originalname,
        numbers: numbers,
        count: numbers.length,
        scheduledAt,
        status: scheduledAt ? 'scheduled' : 'queued',
        createdAt: new Date()
      };

      if (!scheduledAt || scheduledAt <= new Date()) {
        // Run immediately
        bulkCallQueue.push(...numbers);
        broadcastBulkCallStatus();
        processBulkCallQueue();
        res.json({ success: true, count: numbers.length, message: "Bulk calls started immediately" });
      } else {
        // Schedule for later
        pendingJobs.push(job);
        io.emit("jobScheduled", job);
        
        const delay = scheduledAt.getTime() - Date.now();
        setTimeout(() => {
          const activeJob = pendingJobs.find(j => j.id === job.id);
          if (activeJob) {
            bulkCallQueue.push(...activeJob.numbers);
            broadcastBulkCallStatus();
            processBulkCallQueue();
            pendingJobs = pendingJobs.filter(j => j.id !== job.id);
          }
        }, Math.max(delay, 0));
        
        res.json({ 
          success: true, 
          count: numbers.length, 
          scheduledAt: scheduledAt.toISOString(),
          message: `Bulk calls scheduled for ${scheduledAt.toLocaleString()}`
        });
      }
    })
    .on("error", (err) => {
      try {
        if (fs.existsSync(path)) {
          fs.unlinkSync(path);
        }
      } catch (unlinkErr) {
        console.log("Warning: Could not delete temp file", unlinkErr)
      }
      res.status(500).json({ success: false, message: "CSV parse error: " + err.message });
    });
});
// -------------------------------------------
//  DEBUG ENDPOINT - TEST CSV PARSING
// -------------------------------------------
app.post("/api/debug-csv", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No file uploaded" });
  }

  const path = req.file.path;
  const debugInfo = {
    fileName: req.file.originalname,
    fileSize: req.file.size,
    columns: [],
    rows: [],
    numbersFound: []
  };

  fs.createReadStream(path)
    .pipe(csv())
    .on("headers", (headers) => {
      debugInfo.columns = headers;
      console.log('📊 CSV Headers:', headers);
    })
    .on("data", (row) => {
      debugInfo.rows.push(row);
      
      // Try to find phone numbers
      Object.entries(row).forEach(([key, value]) => {
        if (value && value.toString().trim()) {
          const cleanValue = value.toString().trim();
          const digitCount = (cleanValue.match(/\d/g) || []).length;
          if (digitCount >= 7) {
            debugInfo.numbersFound.push({
              field: key,
              value: cleanValue,
              digits: digitCount,
              cleaned: cleanValue.replace(/[^\d+]/g, '')
            });
          }
        }
      });
    })
    .on("end", () => {
      try {
        fs.unlinkSync(path);
      } catch (err) {
        console.log("Warning: Could not delete temp file", err);
      }
      
      res.json({
        success: true,
        debug: debugInfo,
        summary: {
          totalRows: debugInfo.rows.length,
          columns: debugInfo.columns,
          potentialNumbers: debugInfo.numbersFound.length,
          numbers: debugInfo.numbersFound
        }
      });
    })
    .on("error", (err) => {
      try {
        if (fs.existsSync(path)) {
          fs.unlinkSync(path);
        }
      } catch (unlinkErr) {
        console.log("Warning: Could not delete temp file", unlinkErr);
      }
      res.status(500).json({ success: false, error: err.message });
    });
});

// In-memory user storage (use database in production)
let users = [
  {
    id: '1',
    email: 'admin@vynce.com',
    password: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // password
    company: 'Vynce Inc',
    firstName: 'Admin',
    lastName: 'User',
    role: 'admin',
    subscription: {
      plan: 'professional',
      status: 'active',
      monthlyPrice: 99,
      setupFee: 199,
      billingCycle: 'monthly',
      nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      maxCalls: 5000,
      usedCalls: 234,
      features: ['voice-calls', 'voicemail', 'scripting', 'analytics', 'api-access']
    },
    createdAt: new Date(),
    lastLogin: new Date()
  }
];

// Subscription plans
// Removed duplicate declaration of subscriptionPlans to fix redeclaration error.

// -------------------------------------------
//  CALL SCRIPTS & NOTES ENDPOINTS
// -------------------------------------------

// In-memory storage for scripts and notes (use database in production)
let callScripts = [
  {
    id: '1',
    name: 'Sales Introduction',
    content: `Hello [Name], this is [Agent] calling from Vynce. 

I noticed your interest in our services and wanted to personally reach out.

Are you available for a quick chat about how we can help [Company]?`,
    category: 'sales',
    isActive: true,
    createdAt: new Date()
  },
  {
    id: '2', 
    name: 'Customer Follow-up',
    content: `Hi [Name], this is [Agent] from Vynce following up on our previous conversation.

I wanted to check if you had any questions about the information we discussed?`,
    category: 'followup',
    isActive: true,
    createdAt: new Date()
  },
  {
    id: '3',
    name: 'Support Check-in',
    content: `Hello [Name], this is [Agent] from Vynce Support.

I'm calling to ensure everything is working smoothly for you and address any concerns you might have.`,
    category: 'support', 
    isActive: true,
    createdAt: new Date()
  }
];

let callNotes = [];

// Get all call scripts
app.get("/api/scripts", (req, res) => {
  res.json({
    success: true,
    scripts: callScripts.filter(script => script.isActive)
  });
});

// Get specific script
app.get("/api/scripts/:id", (req, res) => {
  const script = callScripts.find(s => s.id === req.params.id && s.isActive);
  if (!script) {
    return res.status(404).json({ success: false, message: "Script not found" });
  }
  res.json({ success: true, script });
});

// Create new script
app.post("/api/scripts", (req, res) => {
  const { name, content, category } = req.body;
  
  if (!name || !content) {
    return res.status(400).json({ success: false, message: "Name and content are required" });
  }

  const newScript = {
    id: Date.now().toString(),
    name,
    content,
    category: category || 'general',
    isActive: true,
    createdAt: new Date()
  };

  callScripts.push(newScript);
  
  res.json({ 
    success: true, 
    message: "Script created successfully",
    script: newScript 
  });
});

// Save call notes
app.post("/api/calls/:uuid/notes", (req, res) => {
  const { uuid } = req.params;
  const { content, scriptUsed, outcome, followUpRequired } = req.body;

  const call = allCalls.find(c => c.uuid === uuid);
  if (!call) {
    return res.status(404).json({ success: false, message: "Call not found" });
  }

  const note = {
    id: Date.now().toString(),
    callUuid: uuid,
    phoneNumber: call.number,
    content,
    scriptUsed,
    outcome,
    followUpRequired: followUpRequired || false,
    createdAt: new Date()
  };

  callNotes.push(note);
  
  // Update call with note reference
  call.notes = call.notes || [];
  call.notes.push(note.id);
  call.outcome = outcome;
  
  broadcastCallUpdate(call);
  
  res.json({ 
    success: true, 
    message: "Note saved successfully",
    note 
  });
});


// Get notes for a call
app.get("/api/calls/:uuid/notes", (req, res) => {
  const { uuid } = req.params;
  const notes = callNotes.filter(note => note.callUuid === uuid);
  
  res.json({ 
    success: true, 
    notes 
  });
});

// Update call with outcome
app.post("/api/calls/:uuid/outcome", (req, res) => {
  const { uuid } = req.params;
  const { outcome, followUpRequired } = req.body;

  const call = allCalls.find(c => c.uuid === uuid);
  if (!call) {
    return res.status(404).json({ success: false, message: "Call not found" });
  }

  call.outcome = outcome;
  call.followUpRequired = followUpRequired || false;
  call.updatedAt = new Date();
  
  broadcastCallUpdate(call);
  
  res.json({ 
    success: true, 
    message: "Outcome updated successfully",
    call 
  });
});

// -------------------------------------------
//  VOICEMAIL DETECTION & MESSAGING
// -------------------------------------------

// Voicemail configuration
const voicemailConfig = {
  enabled: true,
  defaultMessage: "Hello, this is Vynce calling. Please call us back at your earliest convenience. Thank you!",
  messages: [
    {
      id: '1',
      name: 'Standard Follow-up',
      content: "Hello, this is [Agent] from Vynce. We're following up on your inquiry. Please call us back at [Number] when you have a moment. Thank you!",
      isActive: true
    },
    {
      id: '2',
      name: 'Sales Outreach',
      content: "Hi there, this is [Agent] from Vynce. I'd like to discuss how we can help [Company] with your needs. Please call me back at [Number]. Have a great day!",
      isActive: true
    },
    {
      id: '3', 
      name: 'Support Check-in',
      content: "Hello, this is [Agent] from Vynce Support. Calling to ensure everything is working properly. If you need assistance, please call us at [Number]. Thank you!",
      isActive: true
    }
  ]
};

// Detect voicemail from call status
function isVoicemail(status, callDuration = 0) {
  // Voicemail indicators
  const voicemailIndicators = [
    'machine', 'voicemail', 'answering machine', 'beep', 'greeting'
  ];
  
  // If call ends quickly (under 30 seconds) and wasn't answered by human
  if (status === 'completed' && callDuration < 30 && callDuration > 5) {
    return true;
  }
  
  // If status indicates answering machine
  if (voicemailIndicators.some(indicator => 
    status.toLowerCase().includes(indicator))) {
    return true;
  }
  
  return false;
}

// Get voicemail messages
app.get("/api/voicemail-messages", (req, res) => {
  res.json({
    success: true,
    enabled: voicemailConfig.enabled,
    messages: voicemailConfig.messages.filter(msg => msg.isActive)
  });
});

// Update voicemail message
app.post("/api/voicemail-messages", (req, res) => {
  const { name, content } = req.body;
  
  if (!name || !content) {
    return res.status(400).json({ 
      success: false, 
      message: "Name and content are required" 
    });
  }

  const newMessage = {
    id: Date.now().toString(),
    name,
    content,
    isActive: true
  };

  voicemailConfig.messages.push(newMessage);
  
  res.json({ 
    success: true, 
    message: "Voicemail message created successfully",
    voicemailMessage: newMessage 
  });
});

// Enhanced status webhook with voicemail detection
app.post("/status", (req, res) => {
  const { uuid, conversation_uuid, to, status, direction, duration } = req.body;
  console.log(`ℹ️ Call status update: ${uuid} to ${to} -> ${status}`);
  
  let callUuid = uuid || conversation_uuid;
  const match = allCalls.find((c) => c.uuid === callUuid);
  
  if (match) {
    match.status = status;
    match.updatedAt = new Date();
    match.duration = duration || match.duration;
    
    // Map Vonage status to more user-friendly statuses
    const statusMap = {
      'started': 'ringing',
      'ringing': 'ringing', 
      'answered': 'answered',
      'completed': 'completed',
      'busy': 'busy',
      'failed': 'failed',
      'rejected': 'rejected',
      'timeout': 'timeout',
      'cancelled': 'cancelled',
      'machine': 'voicemail'
    };
    
    match.userStatus = statusMap[status] || status;
    
    // Check for voicemail
    if (isVoicemail(status, duration)) {
      match.voicemailDetected = true;
      match.voicemailLeft = false; // We'll set this when we actually leave a message
      console.log(`🎯 Voicemail detected for call ${callUuid}`);
      
      // Auto-leave voicemail if enabled
      if (voicemailConfig.enabled) {
        leaveVoicemail(match);
      }
    }
    
    broadcastCallUpdate(match);
  } else {
    console.log('⚠️ Call not found for status update:', callUuid);
  }
  
  res.sendStatus(200);
});

// Function to leave voicemail message
async function leaveVoicemail(call) {
  try {
    console.log(`📢 Attempting to leave voicemail for ${call.number}`);
    
    // Get the default voicemail message
    const defaultMessage = voicemailConfig.messages.find(msg => msg.isActive) || 
                          voicemailConfig.messages[0];
    
    if (!defaultMessage) {
      console.log('❌ No active voicemail messages configured');
      return;
    }
    
    // Personalize the message
    let personalizedMessage = defaultMessage.content
      .replace(/\[Agent\]/g, 'Vynce Team')
      .replace(/\[Number\]/g, callerId)
      .replace(/\[Company\]/g, call.metadata?.company || 'your company');
    
    console.log(`📝 Voicemail message: ${personalizedMessage}`);
    
    // In a real implementation, you would:
    // 1. Use Vonage's TTS (Text-to-Speech) to play the message
    // 2. Or play a pre-recorded audio file
    // 3. Or use NCCO to dynamically speak the message
    
    // For now, we'll simulate leaving the voicemail
    // In production, you'd integrate with Vonage's Voice API to play TTS
    
    call.voicemailLeft = true;
    call.voicemailMessage = personalizedMessage;
    call.voicemailLeftAt = new Date();
    
    console.log(`✅ Voicemail left for ${call.number}`);
    broadcastCallUpdate(call);
    
  } catch (error) {
    console.error('❌ Error leaving voicemail:', error);
    call.voicemailError = error.message;
    broadcastCallUpdate(call);
  }
}

// Enhanced NCCO for voicemail detection and messaging
app.get("/voice-enhanced", (req, res) => {
  const { to } = req.query;
  
  const ncco = [
    {
      "action": "connect",
      "from": callerId,
      "endpoint": [
        {
          "type": "phone",
          "number": forwardTo
        }
      ],
      "eventUrl": ["https://cuddly-ideas-throw.loca.lt/status"]
    },
    // Fallback - if call fails or goes to voicemail
    {
      "action": "talk",
      "text": voicemailConfig.defaultMessage,
      "voiceName": "Amy",
      "style": 0
    }
  ];
  
  res.json(ncco);
});

// Advanced NCCO with machine detection
app.get("/voice-advanced", (req, res) => {
  const ncco = [
    {
      "action": "connect",
      "from": callerId,
      "endpoint": [
        {
          "type": "phone", 
          "number": forwardTo
        }
      ],
      "machineDetection": "continue", // Enable answering machine detection
      "eventUrl": ["https://cuddly-ideas-throw.loca.lt/status"]
    },
    // This will execute if machine is detected or call fails
    {
      "action": "talk",
      "text": voicemailConfig.defaultMessage,
      "voiceName": "Amy",
      "style": 0
    }
  ];
  
  res.json(ncco);
});

// Update outbound call to use enhanced NCCO
async function initiateCallWithVoicemail(toNumber, metadata = {}) {
  try {
    // First, create a "dialing" entry
    const dialingEntry = { 
      number: toNumber, 
      uuid: `dialing-${Date.now()}`,
      status: "dialing", 
      createdAt: new Date(),
      ...metadata,
      type: 'bulk',
      voicemailEnabled: voicemailConfig.enabled
    };
    allCalls.push(dialingEntry);
    broadcastCallUpdate(dialingEntry);

    console.log(`📞 Dialing ${toNumber} with voicemail detection...`);
    
    const response = await vonage.voice.createOutboundCall({
      to: [{ type: "phone", number: toNumber }],
      from: { type: "phone", number: callerId },
      answer_url: ["https://cuddly-ideas-throw.loca.lt/voice-advanced"], // Use advanced NCCO
      event_url: ["https://cuddly-ideas-throw.loca.lt/status"],
      machine_detection: "continue" // Enable machine detection
    });

    const uuid = response.uuid || (response.calls && response.calls[0].uuid);
    
    // Update the entry with real UUID and status
    const realEntry = { 
      number: toNumber, 
      uuid, 
      status: "initiated", 
      createdAt: new Date(),
      ...metadata,
      type: 'bulk',
      voicemailEnabled: voicemailConfig.enabled
    };
    
    // Replace the dialing entry with the real one
    const dialingIndex = allCalls.findIndex(call => call.uuid === dialingEntry.uuid);
    if (dialingIndex !== -1) {
      allCalls[dialingIndex] = realEntry;
    } else {
      allCalls.push(realEntry);
    }
    
    broadcastCallUpdate(realEntry);
    console.log(`✅ Dialed ${toNumber} with voicemail detection, Call UUID: ${uuid}`);
    return realEntry;
  } catch (err) {
    console.error(`❌ Error dialing ${toNumber}:`, err.message);
    
    // Update the dialing entry to show failure
    const failedCall = allCalls.find(call => 
      call.number === toNumber && call.status === "dialing"
    );
    if (failedCall) {
      failedCall.status = "failed";
      failedCall.error = err.message;
      broadcastCallUpdate(failedCall);
    }
    
    throw err;
  }
}

// Update the make-call endpoint to use enhanced calling
app.post("/api/make-call-enhanced", async (req, res) => {
  const to = req.body.to;
  const enableVoicemail = req.body.voicemail !== false; // Default to true
  
  if (!to) return res.status(400).json({ success: false, message: "Missing number" });
  
  try {
    const entry = await initiateCallWithVoicemail(to);
    res.json({ success: true, data: entry });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Add this to ensure the default user exists
if (!users.find(u => u.email === 'admin@vynce.com')) {
  users.push({
    id: '1',
    email: 'admin@vynce.com',
    password: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // password
    company: 'Vynce Inc',
    firstName: 'Admin',
    lastName: 'User',
    role: 'admin',
    subscription: {
      plan: 'premium',
      status: 'active',
      monthlyPrice: 99,
      setupFee: 199,
      billingCycle: 'monthly',
      nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      maxCalls: 5000,
      usedCalls: 234,
      features: ['voice-calls', 'voicemail', 'scripting', 'analytics', 'api-access']
    },
    createdAt: new Date(),
    lastLogin: new Date()
  });
}

// -------------------------------------------
//  USER & SUBSCRIPTION MANAGEMENT
// -------------------------------------------

// In-memory user storage (use database in production)
// Only initialize users if it hasn't been declared earlier to avoid redeclaration errors.
if (typeof users === "undefined") {
  users = [
    {
      id: '1',
      email: 'admin@vynce.com',
      password: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // password
      company: 'Vynce Inc',
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin',
      subscription: {
        plan: 'premium',
        status: 'active',
        monthlyPrice: 99,
        setupFee: 199,
        billingCycle: 'monthly',
        nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        maxCalls: 5000,
        usedCalls: 234,
        features: ['voice-calls', 'voicemail', 'scripting', 'analytics', 'api-access']
      },
      createdAt: new Date(),
      lastLogin: new Date()
    }
  ];
}

let userSessions = [];

// Subscription plans
const subscriptionPlans = {
  starter: {
    name: 'Starter',
    monthlyPrice: 49,
    setupFee: 99,
    maxCalls: 1000,
    features: ['voice-calls', 'basic-scripting', 'call-analytics'],
    description: 'Perfect for small teams'
  },
  professional: {
    name: 'Professional', 
    monthlyPrice: 99,
    setupFee: 199,
    maxCalls: 5000,
    features: ['voice-calls', 'voicemail', 'scripting', 'analytics', 'api-access'],
    description: 'For growing businesses'
  },
  enterprise: {
    name: 'Enterprise',
    monthlyPrice: 199,
    setupFee: 499,
    maxCalls: 20000,
    features: ['voice-calls', 'voicemail', 'scripting', 'analytics', 'api-access', 'priority-support', 'custom-integrations'],
    description: 'For large organizations'
  }
};

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'vynce-saas-secret-key';

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// -------------------------------------------
//  AUTHENTICATION ENDPOINTS
// -------------------------------------------

// User registration
app.post("/api/auth/register", async (req, res) => {
  const { email, password, firstName, lastName, company, plan = 'starter' } = req.body;

  if (!email || !password || !firstName || !lastName) {
    return res.status(400).json({ success: false, message: 'All fields are required' });
  }

  // Check if user already exists
  const existingUser = users.find(u => u.email === email);
  if (existingUser) {
    return res.status(400).json({ success: false, message: 'User already exists' });
  }

  try {
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user with subscription
    const newUser = {
      id: uuidv4(),
      email,
      password: hashedPassword,
      firstName,
      lastName,
      company: company || `${firstName}'s Company`,
      role: 'user',
      subscription: {
        plan,
        status: 'trial', // 14-day trial
        monthlyPrice: subscriptionPlans[plan].monthlyPrice,
        setupFee: subscriptionPlans[plan].setupFee,
        billingCycle: 'monthly',
        trialEnds: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        nextBillingDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        maxCalls: subscriptionPlans[plan].maxCalls,
        usedCalls: 0,
        features: subscriptionPlans[plan].features
      },
      createdAt: new Date(),
      lastLogin: new Date()
    };

    users.push(newUser);

    // Generate JWT token
    const token = jwt.sign(
      { userId: newUser.id, email: newUser.email, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: {
        id: newUser.id,
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        company: newUser.company,
        role: newUser.role,
        subscription: newUser.subscription
      },
      token
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// User login
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password required' });
  }

  try {
    const user = users.find(u => u.email === email);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Check password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Update last login
    user.lastLogin = new Date();

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        company: user.company,
        role: user.role,
        subscription: user.subscription
      },
      token
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Get current user profile
app.get("/api/auth/me", authenticateToken, (req, res) => {
  const user = users.find(u => u.id === req.user.userId);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      company: user.company,
      role: user.role,
      subscription: user.subscription,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin
    }
  });
});

// Get subscription plans
app.get("/api/subscription/plans", (req, res) => {
  res.json({
    success: true,
    plans: subscriptionPlans
  });
});

// Update subscription
app.post("/api/subscription/upgrade", authenticateToken, (req, res) => {
  const { plan } = req.body;
  const user = users.find(u => u.id === req.user.userId);

  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  if (!subscriptionPlans[plan]) {
    return res.status(400).json({ success: false, message: 'Invalid plan' });
  }

  // Update user subscription
  user.subscription.plan = plan;
  user.subscription.monthlyPrice = subscriptionPlans[plan].monthlyPrice;
  user.subscription.setupFee = subscriptionPlans[plan].setupFee;
  user.subscription.maxCalls = subscriptionPlans[plan].maxCalls;
  user.subscription.features = subscriptionPlans[plan].features;

  // In production, you'd integrate with Stripe/PayPal here
  res.json({
    success: true,
    message: `Subscription upgraded to ${subscriptionPlans[plan].name}`,
    subscription: user.subscription
  });
});

// Check call limits middleware
const checkCallLimit = (req, res, next) => {
  const user = users.find(u => u.id === req.user.userId);
  
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  // Check if user has exceeded call limit
  if (user.subscription.usedCalls >= user.subscription.maxCalls) {
    return res.status(429).json({ 
      success: false, 
      message: 'Call limit exceeded. Please upgrade your plan.' 
    });
  }

  next();
};

// -------------------------------------------
//  UPDATE EXISTING ENDPOINTS WITH AUTH
// -------------------------------------------

// Protect all call-related endpoints
app.get("/api/calls", authenticateToken, (req, res) => {
  const userCalls = allCalls.filter(call => call.userId === req.user.userId);
  res.json(userCalls);
});

app.post("/api/make-call", authenticateToken, checkCallLimit, async (req, res) => {
  const to = req.body.to;
  if (!to) return res.status(400).json({ success: false, message: "Missing number" });
  
  try {
    const user = users.find(u => u.id === req.user.userId);
    const entry = await initiateCall(to, { userId: user.id });
    
    // Increment call count
    user.subscription.usedCalls += 1;
    
    res.json({ success: true, data: entry });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/upload-csv", authenticateToken, checkCallLimit, upload.single("file"), (req, res) => {
  // ... existing CSV code, but add userId to calls
  const user = users.find(u => u.id === req.user.userId);
  
  // In the CSV processing, add userId to each call
  numbers.forEach(contact => {
    allCalls.push({
      number: contact.number,
      name: contact.metadata.name,
      status: 'queued',
      createdAt: new Date(),
      type: 'bulk',
      userId: user.id // Add user ID
    });
  });
  
  // Update user's call count
  user.subscription.usedCalls += numbers.length;
});

// Add user-specific data filtering to other endpoints...

// -------------------------------------------
//  BILLING & PAYMENT WEBHOOKS (SIMPLIFIED)
// -------------------------------------------

app.post("/api/webhooks/payment-success", (req, res) => {
  // In production, this would verify webhook from Stripe/PayPal
  const { userId, plan, amount } = req.body;
  
  const user = users.find(u => u.id === userId);
  if (user) {
    user.subscription.status = 'active';
    user.subscription.plan = plan;
    user.subscription.nextBillingDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    console.log(`✅ Payment processed for user ${user.email}`);
  }
  
  res.json({ success: true });
});



// -------------------------------------------
//  START SERVER
// -------------------------------------------
const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`\n🚀 Vynce Server running on port ${PORT}`)
  console.log(`📍 Local: http://localhost:${PORT}`)
  console.log(`\n📋 Available Endpoints:`)
  console.log(`   ✅ Health check: GET http://localhost:${PORT}/api/health`)
  console.log(`   📤 CSV Upload: POST http://localhost:${PORT}/api/upload-csv`)
  console.log(`   📊 Calls list: GET http://localhost:${PORT}/api/calls`)
  console.log(`   📞 Make call: POST http://localhost:${PORT}/api/make-call`)
  console.log(`   📈 Bulk status: GET http://localhost:${PORT}/api/bulk-status`)
  console.log(`   🛑 Stop bulk: POST http://localhost:${PORT}/api/stop-bulk-calls`)
  console.log(`\n🔧 Test the server by visiting: http://localhost:${PORT}/api/health\n`)
})