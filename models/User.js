const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const Schema = mongoose.Schema;

const defaultContactInfoSchema = new Schema({
    name: { type: String, trim: true },
    phone: { type: String, trim: true }
}, { _id: false });

const defaultShippingInfoSchema = new Schema({
    method: { type: String }, 
    city: { type: String, trim: true },
    warehouse: { type: String, trim: true }, 
    address: { type: String, trim: true }  
}, { _id: false });

const userSchema = new Schema({
    googleId: {
        type: String,
        unique: true,
        sparse: true 
    },
    email: {
        type: String,
        required: [true, 'Email є обов\'язковим'],
        unique: true, 
        lowercase: true,
        trim: true,
        match: [/.+@.+\..+/, 'Будь ласка, введіть дійсний email']
    },
    password: {
        type: String,
        minlength: [5, 'Пароль повинен містити принаймні 5 символів']
    },
    name: {
        type: String,
        trim: true
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user'
    },
    profilePicture: {
        type: String 
    },
    defaultContactInfo: {
        type: defaultContactInfoSchema,
        default: null 
    },
    defaultShippingInfo: {
        type: defaultShippingInfoSchema,
        default: null 
    },
        wishlist: [{
        type: Schema.Types.ObjectId,
        ref: 'Product'
    }]
}, { timestamps: true });

userSchema.pre('save', async function(next) {
    // Хешуємо пароль, тільки якщо він був змінений І ще не є хешем
    if (!this.isModified('password')) {
        return next();
    }

    try {
        // Проста перевірка: хеші bcrypt довгі і починаються з певних символів
        if (this.password && this.password.length > 50 && this.password.startsWith('$2')) {
            return next(); // Це вже хеш, нічого не робимо
        }

        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

userSchema.methods.comparePassword = async function(candidatePassword) {
    if (!this.password) {
        return false;
    }
    try {
        return await bcrypt.compare(candidatePassword, this.password);
    } catch (error) {
        throw error;
    }
};

userSchema.index({ email: 1 }, { unique: true });

module.exports = mongoose.model('User', userSchema);
