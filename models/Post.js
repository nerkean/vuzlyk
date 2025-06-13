const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const postSchema = new Schema({
    title: {
        type: String,
        required: [true, 'Заголовок статті є обов\'язковим'],
        trim: true
    },
    slug: {
        type: String,
        required: true,
        unique: true,
        lowercase: true
    },
    summary: {
        type: String,
        required: [true, 'Короткий опис статті є обов\'язковим'],
        trim: true
    },
    content: {
        type: String,
        required: [true, 'Вміст статті є обов\'язковим']
    },
    imageUrl: {
        type: String, 
        required: false
    },
    imagePublicId: { 
        type: String,
        required: false
    },
    authorDisplay: { 
        type: String,
        default: 'Вузлик до вузлика',
        trim: true
    },
    tags: [{
        type: String,
        trim: true,
        lowercase: true
    }],
    isPublished: {
        type: Boolean,
        default: false
    },
    publishedAt: {
        type: Date
    },
    metaTitle: {
        type: String,
        trim: true
    },
    metaDescription: {
        type: String,
        trim: true
    },
    views: { 
        type: Number,
        default: 0
    }
}, { timestamps: true });

postSchema.pre('validate', function(next) {
    if (this.title && (this.isNew || this.isModified('title'))) {
        const uaToEn = {
            'а': 'a', 'б': 'b', 'в': 'v', 'г': 'h', 'ґ': 'g', 'д': 'd', 'е': 'e', 'є': 'ie', 'ж': 'zh',
            'з': 'z', 'и': 'y', 'і': 'i', 'ї': 'i', 'й': 'i', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n',
            'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts',
            'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ь': '', 'ю': 'iu', 'я': 'ia',
            ' ': '-', '_': '-', '/': '-', '\\': '-'
        };
        this.slug = this.title.toLowerCase()
            .split('').map(char => uaToEn[char] || char)
            .join('')
            .replace(/[^\w-]+/g, '') 
            .replace(/--+/g, '-');  
    }
    next();
});

postSchema.pre('save', function(next) {
    if (this.isModified('isPublished') && this.isPublished && !this.publishedAt) {
        this.publishedAt = new Date();
    } else if (this.isModified('isPublished') && !this.isPublished) {
        this.publishedAt = null;
    }
    next();
});

module.exports = mongoose.model('Post', postSchema);