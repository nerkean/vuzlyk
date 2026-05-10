const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const verificationSchema = new Schema({
    email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
        index: true 
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    hashedPassword: {
        type: String,
        required: true
    },
    verificationCode: {
        type: String,
        required: true
    },
    expiresAt: {
        type: Date,
        required: true,
        expires: 0
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

verificationSchema.index({ email: 1 }, { unique: true });

module.exports = mongoose.model('Verification', verificationSchema);