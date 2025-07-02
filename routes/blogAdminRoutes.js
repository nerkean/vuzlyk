const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');
const cloudinary = require('cloudinary').v2;
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
const Post = require('../models/Post');
const csrf = require('csurf');

const csrfProtection = csrf({ cookie: true });

function checkAdminAuth(req, res, next) {
    if (req.session && req.session.isAdmin) {
        return next();
    }
    res.redirect('/admin/login');
}

const blogImageUploadDir = path.join(__dirname, '..', 'public', 'images', 'blog_uploads_temp');
fs.mkdir(blogImageUploadDir, { recursive: true })
    .then(() => console.log(`[Blog Admin Routes] Папка для тимчасових завантажень зображень блогу: ${blogImageUploadDir}`))
    .catch(err => console.error(`[Blog Admin Routes] Помилка створення папки ${blogImageUploadDir}:`, err));

const blogStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, blogImageUploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'blog-image-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const blogFileFilter = (req, file, cb) => {
    const imageMime = /image\/(jpeg|jpg|png|gif|webp)/.test(file.mimetype);
    const imageExt = /jpeg|jpg|png|gif|webp/.test(path.extname(file.originalname).toLowerCase());
    if (imageMime && imageExt) {
        return cb(null, true);
    }
    req.fileValidationError = 'Для зображення статті дозволено: JPG, PNG, GIF, WEBP.';
    return cb(null, false);
};

const blogUpload = multer({
    storage: blogStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: blogFileFilter
});

router.get('/', checkAdminAuth, csrfProtection, async (req, res, next) => { // 1. Добавили csrfProtection
    try {
        const posts = await Post.find({}).sort({ createdAt: -1 }).lean();
        res.render('admin/blog/index', {
            pageTitle: 'Керування Блогом',
            posts: posts,
            layout: 'admin/layout',
            csrfToken: req.csrfToken() // 2. Передали токен в шаблон
        });
    } catch (error) {
        console.error("[Blog Admin Routes] Помилка завантаження статей:", error);
        next(error);
    }
});

router.get('/new', checkAdminAuth, csrfProtection, (req, res) => {
    res.render('admin/blog/new-post', {
        pageTitle: 'Додати Нову Статтю',
        post: {},
        errors: null,
        formData: {},
        layout: 'admin/layout',
        csrfToken: req.csrfToken()
    });
});

function debugCsrf(req, res, next) {
    console.log('--- ДЕБАГ CSRF ---');
    console.log('Токен в сессии (секрет):', req.session ? req.session.csrfSecret : 'Сессия не найдена');
    console.log('Токен из тела запроса (_csrf):', req.body ? req.body._csrf : 'Тело запроса (req.body) пустое');
    console.log('------------------');
    next();
}

router.post('/', checkAdminAuth, blogUpload.single('imageFile'), debugCsrf, csrfProtection, async (req, res, next) => {
    const { title, summary, content, tags, metaTitle, metaDescription, isPublished } = req.body;
    let errors = [];

    if (!title || title.trim() === '') errors.push({ msg: 'Заголовок є обов\'язковим' });
    if (!summary || summary.trim() === '') errors.push({ msg: 'Короткий опис є обов\'язковим' });
    if (!content || content.trim() === '') errors.push({ msg: 'Вміст статті є обов\'язковим' });

    if (req.fileValidationError) {
        errors.push({ msg: req.fileValidationError });
    }

    if (errors.length > 0) {
        if (req.file) {
            await fs.unlink(req.file.path).catch(e => console.error("Failed to delete temp file on validation error:", e));
        }
        return res.render('admin/blog/new-post', {
            pageTitle: 'Помилка - Додати Статтю',
            errors: errors,
            formData: req.body,
            post: req.body,
            layout: 'admin/layout',
            csrfToken: req.csrfToken()
        });
    }

    let imageUrlDb = null;
    let imagePublicIdDb = null;

    try {
        if (req.file) {
            const uploadResult = await cloudinary.uploader.upload(req.file.path, {
                folder: "blog_images",
                resource_type: "image"
            });
            imageUrlDb = uploadResult.secure_url;
            imagePublicIdDb = uploadResult.public_id;
            await fs.unlink(req.file.path);
        }

        const newPost = new Post({
            title,
            summary,
            content,
            imageUrl: imageUrlDb,
            imagePublicId: imagePublicIdDb,
            tags: tags ? tags.split(',').map(tag => tag.trim()).filter(tag => tag) : [],
            metaTitle: metaTitle || title,
            metaDescription: metaDescription || summary.substring(0, 160),
            isPublished: isPublished === 'on',
            authorDisplay: 'Вузлик до вузлика'
        });

        await newPost.save();
        console.log(`[Blog Admin Routes] Нову статтю "${newPost.title}" збережено.`);
        res.redirect('/admin/blog');

    } catch (error) {
        console.error('[Blog Admin Routes] Помилка створення статті:', error);
        if (req.file && imagePublicIdDb) {
            await cloudinary.uploader.destroy(imagePublicIdDb).catch(e => console.error("Failed to delete from Cloudinary on error:", e));
        } else if (req.file && !imagePublicIdDb) { 
             await fs.unlink(req.file.path).catch(e => console.error("Failed to delete local temp file on error:", e));
        }
        errors.push({ msg: error.message || 'Сталася серверна помилка при збереженні статті.' });
        if (error.code === 11000 && error.keyPattern && error.keyPattern.slug) {
             errors.push({ msg: 'Стаття з таким заголовком (або URL) вже існує. Змініть заголовок.' });
        }
        res.render('admin/blog/new-post', {
            pageTitle: 'Помилка - Додати Статтю',
            errors: errors,
            formData: req.body,
            post: req.body,
            layout: 'admin/layout',
            csrfToken: req.csrfToken()
        });
    }
});

router.get('/:id/edit', checkAdminAuth, csrfProtection, async (req, res, next) => {
    try {
        const postId = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(postId)) {
            return res.redirect('/admin/blog?error=invalid_id');
        }
        const post = await Post.findById(postId).lean();
        if (!post) {
            return res.redirect('/admin/blog?error=notfound');
        }
        res.render('admin/blog/edit-post', {
            pageTitle: `Редагувати: ${post.title}`,
            post: post,
            errors: null,
            formData: post,
            layout: 'admin/layout',
             csrfToken: req.csrfToken()
        });
    } catch (error) {
        console.error('[Blog Admin Routes] Помилка отримання статті для редагування:', error);
        next(error);
    }
});

router.put('/:id', checkAdminAuth,  blogUpload.single('imageFile'), csrfProtection, async (req, res, next) => {
    const postId = req.params.id;
    const { title, summary, content, tags, metaTitle, metaDescription, isPublished, deleteCurrentImage } = req.body;
    let errors = [];

    if (!mongoose.Types.ObjectId.isValid(postId)) {
        errors.push({ msg: 'Неправильний ID статті' });
    }
    if (!title || title.trim() === '') errors.push({ msg: 'Заголовок є обов\'язковим' });
    if (!summary || summary.trim() === '') errors.push({ msg: 'Короткий опис є обов\'язковим' });
    if (!content || content.trim() === '') errors.push({ msg: 'Вміст статті є обов\'язковим' });

    if (req.fileValidationError) {
        errors.push({ msg: req.fileValidationError });
    }
    
    let postToUpdate;
    if (mongoose.Types.ObjectId.isValid(postId) && errors.length === 0) { 
        postToUpdate = await Post.findById(postId);
        if (!postToUpdate) {
             errors.push({ msg: 'Статтю не знайдено для оновлення' });
        }
    }

    if (errors.length > 0) {
        if (req.file) {
            await fs.unlink(req.file.path).catch(e => console.error("Failed to delete temp file on PUT validation error:", e));
        }
        const renderData = postToUpdate ? { ...postToUpdate.toObject(), ...req.body } : req.body;
        return res.render('admin/blog/edit-post', {
            pageTitle: 'Помилка - Редагувати Статтю',
            errors: errors,
            post: renderData,
            formData: renderData,
            layout: 'admin/layout',
             csrfToken: req.csrfToken() 
        });
    }
    
    try {
        postToUpdate.title = title;
        postToUpdate.summary = summary;
        postToUpdate.content = content;
        postToUpdate.tags = tags ? tags.split(',').map(tag => tag.trim()).filter(tag => tag) : [];
        postToUpdate.metaTitle = metaTitle || title;
        postToUpdate.metaDescription = metaDescription || summary.substring(0, 160);
        postToUpdate.isPublished = isPublished === 'on';

        if (deleteCurrentImage === 'true' && postToUpdate.imagePublicId) {
            await cloudinary.uploader.destroy(postToUpdate.imagePublicId);
            postToUpdate.imageUrl = null;
            postToUpdate.imagePublicId = null;
        }

        if (req.file) {
            if (postToUpdate.imagePublicId) {
                await cloudinary.uploader.destroy(postToUpdate.imagePublicId);
            }
            const uploadResult = await cloudinary.uploader.upload(req.file.path, {
                folder: "blog_images",
                resource_type: "image"
            });
            postToUpdate.imageUrl = uploadResult.secure_url;
            postToUpdate.imagePublicId = uploadResult.public_id;
            await fs.unlink(req.file.path);
        }
        
         if (postToUpdate.isModified('title')) {
            const uaToEn = {
                'а': 'a', 'б': 'b', 'в': 'v', 'г': 'h', 'ґ': 'g', 'д': 'd', 'е': 'e', 'є': 'ie', 'ж': 'zh',
                'з': 'z', 'и': 'y', 'і': 'i', 'ї': 'i', 'й': 'i', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n',
                'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts',
                'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ь': '', 'ю': 'iu', 'я': 'ia',
                ' ': '-', '_': '-', '/': '-', '\\': '-'
            };
            postToUpdate.slug = postToUpdate.title.toLowerCase()
                .split('').map(char => uaToEn[char] || char)
                .join('')
                .replace(/[^\w-]+/g, '') 
                .replace(/--+/g, '-');
        }

        await postToUpdate.save();
        console.log(`[Blog Admin Routes] Статтю "${postToUpdate.title}" оновлено.`);
        res.redirect('/admin/blog');

    } catch (error) {
        console.error(`[Blog Admin Routes] Помилка оновлення статті ${postId}:`, error);
         if (req.file) {
            await fs.unlink(req.file.path).catch(e => console.error("Failed to delete temp file on PUT save error:", e));
        }
        errors.push({ msg: error.message || 'Сталася серверна помилка при оновленні статті.' });
         if (error.code === 11000 && error.keyPattern && error.keyPattern.slug) {
             errors.push({ msg: 'Стаття з таким заголовком (або URL) вже існує. Змініть заголовок.' });
        }
        const currentPostData = await Post.findById(postId).lean() || req.body; 
        res.render('admin/blog/edit-post', {
            pageTitle: 'Помилка - Редагувати Статтю',
            errors: errors,
            post: { ...currentPostData, ...req.body },
            formData: { ...currentPostData, ...req.body },
            layout: 'admin/layout',
            csrfToken: req.csrfToken()
        });
    }
});

router.post('/:id/delete', checkAdminAuth, csrfProtection, async (req, res, next) => {
    const postId = req.params.id;
    try {
        if (!mongoose.Types.ObjectId.isValid(postId)) {
            return res.redirect('/admin/blog?error=invalid_id_delete');
        }
        const postToDelete = await Post.findById(postId);
        if (!postToDelete) {
            return res.redirect('/admin/blog?error=notfound_delete');
        }

        if (postToDelete.imagePublicId) {
            await cloudinary.uploader.destroy(postToDelete.imagePublicId);
            console.log(`[Blog Admin Routes] Зображення ${postToDelete.imagePublicId} видалено з Cloudinary.`);
        }

        await Post.findByIdAndDelete(postId); 
        console.log(`[Blog Admin Routes] Статтю ${postId} успішно видалено з БД.`);
        res.redirect('/admin/blog');
    } catch (error) {
        console.error(`[Blog Admin Routes] Помилка видалення статті ${postId}:`, error);
        next(error);
    }
});

router.post('/generate-meta-tags', checkAdminAuth, async (req, res) => {
    const { articleTitle, articleSummary, articleContent } = req.body;

    if (!articleTitle && !articleSummary && !articleContent) {
        return res.status(400).json({ message: 'Заголовок, короткий опис або основний текст статті необхідні для генерації.' });
    }
    if (!process.env.GEMINI_API_KEY) {
        console.error('[AI Blog Meta Gen] GEMINI_API_KEY не знайдено в .env');
        return res.status(500).json({ message: 'Сервіс генерації тимчасово недоступний (відсутній API ключ).' });
    }

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash-latest",
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            ]
        });

        const prompt = `Для статті блогу українською мовою:
        Назва статті: "${articleTitle}"
        Короткий зміст: "${articleSummary || 'Не надано'}"
        Основний текст (перші 300 символів, якщо є): "${articleContent ? articleContent.substring(0, 300) : 'Не надано'}"

        Згенеруй:
        1.  SEO-оптимізований meta_title (максимум 60 символів). Він має бути привабливим, чітким, і якщо можливо, містити ключові слова.
        2.  SEO-оптимізований meta_description (максимум 160 символів). Він має бути унікальним, інформативним, спонукати до кліку, і також містити ключові слова.

        Уникай прямого повторення назви статті у meta_description, якщо назва вже довга і інформативна.
        Важливо: відповідь надай ТІЛЬКИ у форматі JSON об'єкта з двома ключами: "meta_title" та "meta_description". Без жодних додаткових пояснень, тексту до або після JSON.
        Приклад формату відповіді:
        {
          "meta_title": "Згенерований Meta Title тут",
          "meta_description": "Згенерований Meta Description тут."
        }`;

        console.log(`[AI Blog Meta Gen] Sending prompt for article: ${articleTitle}`);
        const result = await model.generateContent(prompt);
        const response = result.response;
        let aiResponseText = response.text();
        
        console.log(`[AI Blog Meta Gen] Raw AI response: ${aiResponseText}`);

        let generatedMetaTitle = '';
        let generatedMetaDescription = '';

        try {
            const jsonMatch = aiResponseText.match(/```json\s*([\s\S]*?)\s*```|({[\s\S]*})/);
            let cleanedJsonString = aiResponseText;

            if (jsonMatch && jsonMatch[1]) { 
                cleanedJsonString = jsonMatch[1];
            } else if (jsonMatch && jsonMatch[2]) { 
                cleanedJsonString = jsonMatch[2];
            }
            cleanedJsonString = cleanedJsonString.trim();

            const parsedResponse = JSON.parse(cleanedJsonString);
            generatedMetaTitle = parsedResponse.meta_title || articleTitle.substring(0,60);
            generatedMetaDescription = parsedResponse.meta_description || (articleSummary || articleContent || '').substring(0,160);
        } catch (parseError) {
            console.error('[AI Blog Meta Gen] Error parsing AI JSON response:', parseError, "Raw response was:", aiResponseText);
            generatedMetaTitle = articleTitle.substring(0,60);
            generatedMetaDescription = (articleSummary || articleContent || '').substring(0,157) + "...";
            
            const titleMatchFallback = aiResponseText.match(/"meta_title":\s*"([^"]*)"/i);
            const descMatchFallback = aiResponseText.match(/"meta_description":\s*"([^"]*)"/i);
            if (titleMatchFallback && titleMatchFallback[1]) generatedMetaTitle = titleMatchFallback[1];
            if (descMatchFallback && descMatchFallback[1]) generatedMetaDescription = descMatchFallback[1];
        }

        if (generatedMetaTitle.length > 70) {
             const lastSpace = generatedMetaTitle.lastIndexOf(' ', 67);
             generatedMetaTitle = (lastSpace > 0 ? generatedMetaTitle.substring(0, lastSpace) : generatedMetaTitle.substring(0, 67)) + "...";
        }
        if (generatedMetaDescription.length > 160) {
            const lastSpace = generatedMetaDescription.lastIndexOf(' ', 157);
            generatedMetaDescription = (lastSpace > 0 ? generatedMetaDescription.substring(0, lastSpace) : generatedMetaDescription.substring(0, 157)) + "...";
        }

        console.log(`[AI Blog Meta Gen] Article: ${articleTitle}`);
        console.log(`[AI Blog Meta Gen] Generated Meta Title: ${generatedMetaTitle}`);
        console.log(`[AI Blog Meta Gen] Generated Meta Description: ${generatedMetaDescription}`);

        res.json({
            metaTitle: generatedMetaTitle.trim(),
            metaDescription: generatedMetaDescription.trim()
        });

    } catch (error) {
        console.error('[Blog Admin Routes] Помилка генерації мета-тегів для статті:', error);
        let userMessage = 'Не вдалося згенерувати мета-теги.';
         if (error.message && error.message.includes('SAFETY')) {
            userMessage = 'Генерація була заблокована через налаштування безпеки. Спробуйте змінити текст статті.';
        } else if (error.message && error.message.includes('API key not valid')) {
             userMessage = 'Помилка конфігурації AI: недійсний API ключ.';
        } else if (error.response && error.response.promptFeedback && error.response.promptFeedback.blockReason) {
            userMessage = `Генерація заблокована: ${error.response.promptFeedback.blockReason}. Спробуйте перефразувати.`;
            console.warn('[AI Blog Meta Gen] Blocked by safety settings:', error.response.promptFeedback);
        }
        res.status(500).json({ message: userMessage });
    }
});

router.get('/html-guide', checkAdminAuth, (req, res) => {
    res.render('admin/blog/html-guide', {
        pageTitle: 'Інструкція по HTML для Статей',
        layout: 'admin/layout'
    });
});

module.exports = router;
