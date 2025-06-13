const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const orderItemSchema = new Schema({
    productId: {
        type: String,
        required: true
    },
    name: {
        type: String,
        required: true
    },
    quantity: {
        type: Number,
        required: true,
        min: 1
    },
    price: {
        type: Number,
        required: true
    }
}, { _id: false });

const orderSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',   
        index: true 
    },
    receivedAt: {
        type: Date,
        default: Date.now
    },
    contactInfo: {
        name: { type: String, required: [true, 'Ім\'я є обов\'язковим'] },
        email: { type: String, required: [true, 'Email є обов\'язковим'], lowercase: true, trim: true },
        phone: { type: String, required: [true, 'Телефон є обов\'язковим'] }
    },
    shipping: {
        method: { type: String, required: [true, 'Метод доставки є обов\'язковим'] },
        city: { type: String },
        warehouse: { type: String },
        address: { type: String }
    },
    items: {
        type: [orderItemSchema],
        required: true,
        validate: [v => Array.isArray(v) && v.length > 0, 'Кошик не може бути порожнім']
    },
    customDescription: {
        type: String,
        default: 'Не вказано'
    },
    comments: {
        type: String,
        default: 'Немає'
    },
    status: {
        type: String,
        enum: ['Новий', 'В обробці', 'Узгоджено', 'Виконано', 'Скасовано'],
        default: 'Новий',
        index: true
    },
    totalAmount: {
        type: Number
    }
}, {
    timestamps: true
});

orderSchema.pre('save', function(next) {
  if (!this.totalAmount && this.items && this.items.length > 0) {
    this.totalAmount = this.items.reduce((sum, item) => {
      const price = typeof item.price === 'number' ? item.price : 0;
      const quantity = typeof item.quantity === 'number' ? item.quantity : 0;
      return sum + (price * quantity);
    }, 0);
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);
