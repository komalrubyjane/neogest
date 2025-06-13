require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const mqtt = require('mqtt');
const axios = require('axios');
const { protect } = require('./middleware/auth');
const User = require('./models/User');

const app = express();

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Email configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'neogestnoreply@gmail.com',
        pass: process.env.EMAIL_APP_PASSWORD
    }
});

// MQTT Configuration
const mqttClient = mqtt.connect('mqtt://broker.hivemq.com');
const ESP32_IP = '192.168.176.134';  // Your ESP32's IP address

// MQTT Topics
const TOPICS = {
    LIGHT: 'neogest/light',
    FAN: 'neogest/fan',
    STATUS: 'neogest/status'
};

// MQTT Connection handling
mqttClient.on('connect', () => {
    console.log('Connected to MQTT broker');
    mqttClient.subscribe(TOPICS.STATUS);
});

mqttClient.on('message', (topic, message) => {
    if (topic === TOPICS.STATUS) {
        // Broadcast status to all connected clients
        // You can implement WebSocket here if needed
        console.log('Device status:', message.toString());
    }
});

// Generate OTP
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// Routes
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // Check if user exists
        let user = await User.findOne({ email });
        if (user) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Generate OTP
        const otp = generateOTP();
        const otpExpiry = new Date();
        otpExpiry.setMinutes(otpExpiry.getMinutes() + 10); // OTP valid for 10 minutes

        // Create new user
        user = new User({
            name,
            email,
            password,
            emailVerificationOTP: otp,
            otpExpiry
        });

        await user.save();

        // Send verification email
        const mailOptions = {
            from: 'neogestnoreply@gmail.com',
            to: email,
            subject: 'Email Verification - NeoGest',
            html: `
                <h2>Welcome to NeoGest!</h2>
                <p>Your verification code is: <strong>${otp}</strong></p>
                <p>This code will expire in 10 minutes.</p>
            `
        };

        await transporter.sendMail(mailOptions);

        res.status(201).json({
            message: 'Registration successful. Please check your email for verification code.',
            userId: user._id
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/verify-email', async (req, res) => {
    try {
        const { userId, otp } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.isEmailVerified) {
            return res.status(400).json({ message: 'Email already verified' });
        }

        if (user.emailVerificationOTP !== otp) {
            return res.status(400).json({ message: 'Invalid OTP' });
        }

        if (new Date() > user.otpExpiry) {
            return res.status(400).json({ message: 'OTP expired' });
        }

        user.isEmailVerified = true;
        user.emailVerificationOTP = null;
        user.otpExpiry = null;
        await user.save();

        // Create token
        const token = jwt.sign(
            { userId: user._id },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            message: 'Email verified successfully',
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Check if user exists
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        // Check if email is verified
        if (!user.isEmailVerified) {
            return res.status(400).json({ message: 'Please verify your email first' });
        }

        // Check password
        const isMatch = await user.matchPassword(password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        // Create token
        const token = jwt.sign(
            { userId: user._id },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Protected Routes
app.get('/api/profile', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .select('-password -emailVerificationOTP -otpExpiry')
            .populate('orders');
        
        res.json(user);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

app.put('/api/profile', protect, async (req, res) => {
    try {
        const { name, phone, address } = req.body;
        const user = await User.findById(req.user._id);

        if (name) user.name = name;
        if (phone) user.phone = phone;
        if (address) user.address = address;

        await user.save();

        res.json({
            message: 'Profile updated successfully',
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                address: user.address,
                role: user.role
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/profile/upload-photo', protect, async (req, res) => {
    try {
        const { profilePic } = req.body;
        const user = await User.findById(req.user._id);

        user.profilePic = profilePic;
        await user.save();

        res.json({
            message: 'Profile picture updated successfully',
            profilePic: user.profilePic
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// ESP32 Control Routes
app.post('/api/device/control', protect, async (req, res) => {
    try {
        const { device, action } = req.body;
        
        if (!['light', 'fan'].includes(device) || !['ON', 'OFF'].includes(action)) {
            return res.status(400).json({ message: 'Invalid device or action' });
        }

        const topic = device === 'light' ? TOPICS.LIGHT : TOPICS.FAN;
        
        // Publish to MQTT
        mqttClient.publish(topic, action);
        
        // Also send HTTP request to ESP32 for redundancy
        try {
            await axios.post(`http://${ESP32_IP}/control`, {
                device,
                action
            });
        } catch (error) {
            console.error('HTTP request to ESP32 failed:', error.message);
            // Continue anyway since MQTT might have worked
        }

        res.json({ message: `${device} turned ${action.toLowerCase()}` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

app.get('/api/device/status', protect, async (req, res) => {
    try {
        // Try to get status from ESP32 directly
        try {
            const response = await axios.get(`http://${ESP32_IP}/status`);
            return res.json(response.data);
        } catch (error) {
            console.error('Failed to get status from ESP32:', error.message);
            // If direct request fails, return last known status from MQTT
            // You might want to implement a status cache here
            return res.status(503).json({ 
                message: 'Device unreachable',
                error: 'ESP32 not responding'
            });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`)); 
