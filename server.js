require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const Razorpay = require('razorpay');
const twilio = require('twilio');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs'); // [Fix 1] Import file system module

const app = express();

// --- MIDDLEWARE ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static('public')); 
app.use('/uploads', express.static('uploads'));

// --- [Fix 2] ENSURE UPLOADS DIRECTORY EXISTS ---
// This prevents the "ENOENT" error when uploading files on a new server
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
    console.log('✅ Created uploads directory');
}

// --- CONFIGURATION ---

// 1. MongoDB Connection
// [Fix 3] Removed localhost default to force cloud connection in production
const mongoURI = process.env.MONGO_URI; 

if (!mongoURI) {
    console.error("❌ FATAL ERROR: MONGO_URI is not defined.");
    // Do not exit process, just log error so server stays alive for logs
} else {
    mongoose.connect(mongoURI)
        .then(() => console.log('✅ MongoDB Connected'))
        .catch(err => console.error('❌ MongoDB Connection Error:', err));
}

// 2. Razorpay Instance
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// 3. Twilio Client
const twilioClient = new twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

// 4. File Upload (Multer) Storage
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: function(req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 2000000 } // 2MB limit
});

// --- DATABASE SCHEMAS ---
// ... (Keep your schemas exactly as they are) ...
const OrderSchema = new mongoose.Schema({
    customerName: String,
    phone: String,
    device: String,
    issue: String,
    address: String,
    location: { lat: String, long: String },
    amount: Number,
    orderId: String,
    paymentId: String,
    status: { type: String, default: 'Pending' },
    createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrderSchema);

const ApplicationSchema = new mongoose.Schema({
    name: String,
    email: String,
    phone: String,
    role: String,
    reason: String,
    resumePath: String,
    createdAt: { type: Date, default: Date.now }
});
const Application = mongoose.model('Application', ApplicationSchema);

const RepairmanSchema = new mongoose.Schema({
    name: String,
    phone: String,
    email: String,
    aadhar: String,
    experience: String,
    skills: [String],
    address: String
});
const Repairman = mongoose.model('Repairman', RepairmanSchema);

// --- ROUTES ---

// [Fix 4] Root Route for Render Health Check
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 1. CREATE ORDER
app.post('/create-order', async (req, res) => {
    try {
        const options = {
            amount: 50000, 
            currency: "INR",
            receipt: "order_rcptid_" + Date.now()
        };
        const order = await razorpay.orders.create(options);
        res.json(order);
    } catch (error) {
        console.error("Order Error:", error); // Log error for debugging
        res.status(500).json({ error: error.message });
    }
});

// ... (Keep verify-payment route as is) ...
app.post('/verify-payment', async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, booking_details } = req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const crypto = require("crypto");
    const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
                                    .update(body.toString())
                                    .digest('hex');

    if (expectedSignature === razorpay_signature) {
        const newOrder = new Order({
            ...booking_details,
            orderId: razorpay_order_id,
            paymentId: razorpay_payment_id,
            status: "Paid"
        });
        await newOrder.save();

        try {
            await twilioClient.messages.create({
                from: process.env.TWILIO_WHATSAPP_FROM,
                to: process.env.ADMIN_WHATSAPP_NUMBER,
                body: `🚀 *New EchoRepers Order!*\n👤 Name: ${booking_details.customerName}\n📱 Phone: ${booking_details.phone}\n🔧 Device: ${booking_details.device}\n💰 Status: PAID`
            });
        } catch (e) {
            console.error("WhatsApp failed:", e);
        }

        res.json({ status: "success" });
    } else {
        res.status(400).json({ status: "failure" });
    }
});

// 3. JOIN TEAM
app.post('/join-team', upload.single('resume'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ status: "error", message: "No file uploaded" });
        }
        
        const newApp = new Application({
            name: req.body.name,
            email: req.body.email,
            phone: req.body.phone,
            role: req.body.role,
            reason: req.body.reason,
            resumePath: req.file.path
        });
        await newApp.save();
        
        res.json({ status: "success", message: "Application received" });
    } catch (error) {
        console.error("Join Team Error:", error);
        res.status(500).json({ status: "error", message: error.message });
    }
});

// 4. REGISTER REPAIRMAN
app.post('/register-repairman', async (req, res) => {
    try {
        const repairman = new Repairman(req.body);
        await repairman.save();
        res.json({ status: "success", message: "Registered successfully" });
    } catch (error) {
        console.error("Register Error:", error);
        res.status(500).json({ status: "error", message: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));