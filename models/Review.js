const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const reviewSchema = new Schema({
    productId: {
        type: Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
        index: true
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    rating: {
        type: Number,
        required: [true, 'Рейтинг є обов\'язковим'],
        min: [1, 'Рейтинг не може бути менше 1'],
        max: [5, 'Рейтинг не може бути більше 5']
    },
    text: {
        type: String,
        trim: true,
        maxlength: [1000, 'Відгук занадто довгий (максимум 1000 символів)']
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

reviewSchema.index({ productId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('Review', reviewSchema);
