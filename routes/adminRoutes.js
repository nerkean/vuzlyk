const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Order = require('../models/Order');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');
const cloudinary = require('cloudinary').v2;
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");

const csrf = require('csurf');
const csrfProtection = csrf({ cookie: true });

const uploadDir = path.join(__dirname, '..', 'public', 'images', 'uploads');
fs.mkdir(uploadDir, { recursive: true })
    .then(() => console.log(`[Admin Routes] Папка для завантажень існує або створена: ${uploadDir}`))
    .catch(err => console.error(`[Admin Routes] Помилка створення папки ${uploadDir}:`, err));

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    if (file.fieldname === "imageFiles") {
        const imageMime = /image\/(jpeg|jpg|png|gif|webp)/.test(file.mimetype);
        const imageExt = /jpeg|jpg|png|gif|webp/.test(path.extname(file.originalname).toLowerCase());
        if (imageMime && imageExt) {
            return cb(null, true);
        }
        req.fileValidationError = req.fileValidationError || {};
        req.fileValidationError[file.fieldname] = 'Для основних зображень дозволено: jpg, png, gif, webp.';
        return cb(null, false);
    } else if (file.fieldname === "livePhotoFile") {
        const liveMime = /image\/gif|video\/mp4|video\/webm/.test(file.mimetype);
        const liveExt = /gif|mp4|webm/.test(path.extname(file.originalname).toLowerCase());
        if (liveMime && liveExt) {
            return cb(null, true);
        }
        req.fileValidationError = req.fileValidationError || {};
        req.fileValidationError[file.fieldname] = 'Для "живого" фото дозволено: GIF, MP4, WebM.';
        return cb(null, false);
    } else {
        console.warn(`[Multer File Filter] Отримано файл з невідомим ім'ям поля: ${file.fieldname}`);
        cb(new Error(`Неочікуване поле файлу: ${file.fieldname}`), false);
    }
};

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: fileFilter
});

const cpUpload = upload.fields([
    { name: 'imageFiles', maxCount: 10 },
    { name: 'livePhotoFile', maxCount: 1 }
]);


function checkAdminAuth(req, res, next) {
    if (req.session && req.session.isAdmin) {
        return next();
    }
    res.redirect('/admin/login');
}

router.get('/login', csrfProtection, (req, res) => { // 1. Добавили csrfProtection
    if (req.session.isAdmin) return res.redirect('/admin/orders');
    res.render('admin/login', {
        error: req.query.error === '1' ? 'Неправильний логін або пароль.' : null,
        csrfToken: req.csrfToken() // 2. Передали токен в шаблон
    });
});

router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const adminUser = process.env.ADMIN_USER;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminUser || !adminPassword) {
        console.error("ПОМИЛКА: ADMIN_USER або ADMIN_PASSWORD не встановлені в .env");
        return res.redirect('/admin/login?error=2');
    }
    if (username === adminUser && password === adminPassword) {
        req.session.isAdmin = true;
        console.log('Admin logged in successfully.');
        res.redirect('/admin/orders');
    } else {
        console.log('Admin login failed.');
        res.redirect('/admin/login?error=1');
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error("Помилка при виході:", err);
        }
        res.clearCookie('connect.sid');
        console.log('Admin logged out.');
        res.redirect('/admin/login');
    });
});


router.get('/orders', checkAdminAuth, csrfProtection, async (req, res) => {
    try {
        const ordersFromDB = await Order.find().sort({ receivedAt: -1 }).lean();
        
        const ordersWithProductDetails = await Promise.all(ordersFromDB.map(async (order) => {
            console.log(`[Admin Orders] Processing order ID: ${order._id}`);
            const itemsWithDetails = await Promise.all(order.items.map(async (item) => {
                let productImageUrl = '/images/placeholder-small.webp'; 
                console.log(`[Admin Orders] Item: "${item.name}", ProductID: "${item.productId}"`);

                if (item.productId && mongoose.Types.ObjectId.isValid(item.productId)) {
                    const product = await Product.findById(item.productId).select('images name').lean();
                    if (product) {
                        console.log(`[Admin Orders] Found product in DB: "${product.name}" (ID: ${product._id})`);
                        if (product.images && Array.isArray(product.images) && product.images.length > 0) {
                            const firstImageSet = product.images[0];
                            console.log(`[Admin Orders] First image set for "${product.name}":`, JSON.stringify(firstImageSet, null, 2));
                            if (firstImageSet.thumb && typeof firstImageSet.thumb === 'object' && firstImageSet.thumb.url) {
                                productImageUrl = firstImageSet.thumb.url;
                                console.log(`[Admin Orders] SUCCESS: Using thumb.url for "${item.name}": ${productImageUrl}`);
                            } else if (firstImageSet.medium && typeof firstImageSet.medium === 'object' && firstImageSet.medium.url) {
                                productImageUrl = firstImageSet.medium.url; 
                                console.log(`[Admin Orders] INFO: Using medium.url for "${item.name}": ${productImageUrl}`);
                            } else if (firstImageSet.large && typeof firstImageSet.large === 'object' && firstImageSet.large.url) {
                                productImageUrl = firstImageSet.large.url; 
                                console.log(`[Admin Orders] INFO: Using large.url for "${item.name}": ${productImageUrl}`);
                            } else if (typeof firstImageSet === 'string') { 
                                productImageUrl = firstImageSet;
                                console.log(`[Admin Orders] INFO: Using direct string from images array for "${item.name}": ${productImageUrl}`);
                            }
                            else {
                                console.log(`[Admin Orders] WARNING: No valid thumb, medium, or large URL in first image set for "${product.name}".`);
                            }
                        } else {
                            console.log(`[Admin Orders] WARNING: Product "${product.name}" has no images array or it's empty.`);
                        }
                    } else {
                        console.log(`[Admin Orders] WARNING: Product not found in DB for ID: ${item.productId} (item name: "${item.name}")`);
                    }
                } else {
                     console.log(`[Admin Orders] WARNING: Invalid or missing ProductID for item: "${item.name}". ProductID value: "${item.productId}"`);
                }
                return { ...item, imageUrl: productImageUrl };
            }));
            return { ...order, items: itemsWithDetails };
        }));

        res.render('admin/orders', {
            orders: ordersWithProductDetails,
            pageTitle: "Керування Замовленнями",
            csrfToken: req.csrfToken()
        });
    } catch (error) {
        console.error("Помилка завантаження замовлень:", error);
        res.status(500).render('admin/error', { message: 'Не вдалося завантажити замовлення' });
    }
});

router.post('/orders/:id/update-status', checkAdminAuth, async (req, res) => {
    const orderId = req.params.id;
    const { newStatus } = req.body;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
        return res.status(400).json({ success: false, message: 'Неправильний ID замовлення.' });
    }
    const allowedStatuses = ['Новий', 'В обробці', 'Узгоджено', 'Виконано', 'Скасовано'];
    if (!newStatus || !allowedStatuses.includes(newStatus)) {
        return res.status(400).json({ success: false, message: 'Неприпустимий статус замовлення.' });
    }
    try {
        const updatedOrder = await Order.findByIdAndUpdate(orderId, { status: newStatus }, { new: true });
        if (!updatedOrder) {
            return res.status(404).json({ success: false, message: 'Замовлення не знайдено.' });
        }
        res.json({ success: true, message: 'Статус оновлено', newStatus: updatedOrder.status });
    } catch (error) {
        console.error(`Помилка оновлення статусу замовлення ${orderId}:`, error);
        res.status(500).json({ success: false, message: 'Помилка сервера при оновленні статусу.' });
    }
});

router.delete('/orders/:id', checkAdminAuth, async (req, res) => {
    const orderId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
        return res.status(400).json({ success: false, message: 'Неправильний ID замовлення.' });
    }
    try {
        const deletedOrder = await Order.findByIdAndDelete(orderId);
        if (!deletedOrder) {
            return res.status(404).json({ success: false, message: 'Замовлення не знайдено.' });
        }
        res.json({ success: true, message: 'Замовлення видалено' });
    } catch (error) {
        console.error(`Помилка видалення замовлення ${orderId}:`, error);
        res.status(500).json({ success: false, message: 'Помилка сервера при видаленні замовлення.' });
    }
});


router.get('/products', checkAdminAuth, csrfProtection, async (req, res, next) => {
    try {
        const products = await Product.find({}).sort({ createdAt: -1 }).lean();
        res.render('admin/products', {
            pageTitle: 'Керування Товарами',
            products: products,
            csrfToken: req.csrfToken()
        });
    } catch (error) {
        console.error("[Admin Routes] Помилка завантаження товарів для адмін-панелі:", error);
        next(error);
    }
});

router.get('/products/new', checkAdminAuth,  csrfProtection, (req, res) => {
    const categories = ['Вишивка'];
    res.render('admin/new-product', {
        pageTitle: 'Додати Новий Товар',
        categories: categories,
        formData: {},
        error: req.query.error || null,
        query: req.query,
        csrfToken: req.csrfToken()
    });
});

router.post('/products', checkAdminAuth, cpUpload, csrfProtection, async (req, res, next) => {
    const categories = ['Вишивка', 'Аксесуари']; // Добавим сюда новую категорию
    const formData = req.body;

    const mainImageFiles = req.files && req.files.imageFiles ? req.files.imageFiles : [];
    const livePhotoFile = req.files && req.files.livePhotoFile ? req.files.livePhotoFile[0] : null;

    let fileValidationErrorMessage = '';
    if (req.fileValidationError) {
        if(req.fileValidationError.imageFiles) fileValidationErrorMessage += req.fileValidationError.imageFiles + " ";
        if(req.fileValidationError.livePhotoFile) fileValidationErrorMessage += req.fileValidationError.livePhotoFile;
    }

    if (fileValidationErrorMessage.trim() !== '') {
        if (mainImageFiles.length > 0) {
            await Promise.all(mainImageFiles.map(file => fs.unlink(file.path).catch(e => console.error("[Admin Routes] Failed to delete invalid main image file:", e.message, file.path))));
        }
        if (livePhotoFile) {
            await fs.unlink(livePhotoFile.path).catch(e => console.error("[Admin Routes] Failed to delete invalid live photo file:", e.message, livePhotoFile.path));
        }
        return res.status(400).render('admin/new-product', {
            pageTitle: 'Помилка - Додати Товар', categories, formData,
            error: fileValidationErrorMessage.trim(), csrfToken: req.csrfToken() 
        });
    }

    if (mainImageFiles.length === 0) { 
        if (livePhotoFile) {
             await fs.unlink(livePhotoFile.path).catch(e => console.error("[Admin Routes] Failed to delete live photo due to no main images:", e.message, livePhotoFile.path));
        }
        return res.status(400).render('admin/new-product', {
            pageTitle: 'Помилка - Додати Товар', categories, formData,
            error: 'Необхідно завантажити хоча б одне основне зображення товару.', csrfToken: req.csrfToken() 
        });
    }
    
    const successfullyProcessedOriginalPaths = [];
    let livePhotoTempPath = null; 

    try {
        let numPrice = 0;
        let numMaxPrice = null;

const {
    name, description, price, maxPrice, category,
    tags, materials, colors, care_instructions, isFeatured,
    creation_time_info, status, metaDescription,
    sku 
} = req.body;


        if (price !== undefined && price !== null && price !== '') {
            numPrice = parseFloat(price);
            if (isNaN(numPrice)) { numPrice = 0; console.warn("[Admin Routes] POST: Некоректний формат ціни, встановлено 0. Отримано:", price); }
        }
        numPrice = numPrice || 0;

        if (maxPrice !== undefined && maxPrice !== null && maxPrice !== '') {
            numMaxPrice = parseFloat(maxPrice);
            if (isNaN(numMaxPrice)) { numMaxPrice = null; }
        }
        numMaxPrice = numMaxPrice || null;

        if (!name || !description || (price === undefined || price === null || price === '') || !category || !creation_time_info) {
            const allTempFiles = mainImageFiles.map(f => f.path);
            if (livePhotoFile) allTempFiles.push(livePhotoFile.path);
            await Promise.all(allTempFiles.map(p => fs.unlink(p).catch(e => console.error("[Admin Routes] Cleanup failed for validation error (missing fields):", e.message, p))));
            return res.status(400).render('admin/new-product', {
                pageTitle: 'Помилка - Додати Товар', categories, formData, error: 'validation', csrfToken: req.csrfToken()
            });
        }
        
        if (numMaxPrice !== null && numMaxPrice < numPrice) {
            const allTempFiles = mainImageFiles.map(f => f.path);
            if (livePhotoFile) allTempFiles.push(livePhotoFile.path);
            await Promise.all(allTempFiles.map(p => fs.unlink(p).catch(e => console.error("[Admin Routes] Cleanup failed for price validation error:", e.message, p))));
            return res.status(400).render('admin/new-product', {
                pageTitle: 'Помилка - Додати Товар', categories, formData, error: 'price_validation', csrfToken: req.csrfToken()
            });
        }

        const processedImagesData = [];
        for (const file of mainImageFiles) {
            const originalPath = file.path;
            const baseFilename = path.parse(file.filename).name;
            const imageSetUrlsAndIds = { large: null, medium: null, thumb: null }; 

            try {
                const imageBuffer = await fs.readFile(originalPath);
                const imageProcessor = sharp(imageBuffer).rotate();

                const sizes = {
                    large: { width: 1000, quality: 80 },
                    medium: { width: 600, quality: 75 },
                    thumb: { width: 300, quality: 70 }
                };

                for (const [sizeName, options] of Object.entries(sizes)) {
                    const processedBuffer = await imageProcessor.clone().resize({ width: options.width, withoutEnlargement: true }).webp({ quality: options.quality }).toBuffer();
                    const publicIdForUpload = `${baseFilename}-${sizeName}-${Date.now()}`;
                    const uploadResult = await new Promise((resolve, reject) => {
                        const uploadStream = cloudinary.uploader.upload_stream(
                            { folder: "products", public_id: publicIdForUpload, resource_type: "image", format: "webp" },
                            (error, result) => error ? reject(error) : resolve(result)
                        );
                        uploadStream.end(processedBuffer);
                    });

                    if (!uploadResult || !uploadResult.secure_url || !uploadResult.public_id) {
                        throw new Error(`Помилка завантаження версії ${sizeName} в Cloudinary для ${file.originalname}`);
                    }
                    imageSetUrlsAndIds[sizeName] = { url: uploadResult.secure_url, public_id: uploadResult.public_id };
                }
                
                if (imageSetUrlsAndIds.large && imageSetUrlsAndIds.large.url && imageSetUrlsAndIds.large.public_id &&
                    imageSetUrlsAndIds.medium && imageSetUrlsAndIds.medium.url && imageSetUrlsAndIds.medium.public_id &&
                    imageSetUrlsAndIds.thumb && imageSetUrlsAndIds.thumb.url && imageSetUrlsAndIds.thumb.public_id) {
                    processedImagesData.push(imageSetUrlsAndIds);
                    successfullyProcessedOriginalPaths.push(originalPath);
                } else {
                    throw new Error(`Не вдалося сформувати повний набір зображень (L,M,S) для файлу ${file.originalname}`);
                }
            } catch (fileProcessingError) {
                console.error(`[Admin Routes] Помилка обробки основного файлу ${file.originalname}:`, fileProcessingError.message);
                try { await fs.unlink(originalPath); } catch (e) { /* ігнор */ }
                throw fileProcessingError; 
            }
        }

        if (processedImagesData.length === 0 && mainImageFiles.length > 0) {
            if (livePhotoFile) await fs.unlink(livePhotoFile.path).catch(e => {});
            return res.status(400).render('admin/new-product', { 
                pageTitle: 'Помилка - Додати Товар', categories, formData,
                error: 'Не вдалося обробити жодного основного зображення.', csrfToken: req.csrfToken()
            });
        }

        let livePhotoUrlDb = null;
        let livePhotoPublicIdDb = null;
        if (livePhotoFile) {
            livePhotoTempPath = livePhotoFile.path;
            console.log(`[Admin Routes] POST: Обробка livePhotoFile: ${livePhotoFile.originalname}`);
            try {
                const uploadResult = await cloudinary.uploader.upload(livePhotoTempPath, {
                    folder: "products/live_photos",
                    resource_type: livePhotoFile.mimetype.startsWith('image/gif') ? "image" : "video",
                });
                if (uploadResult && uploadResult.secure_url) {
                    livePhotoUrlDb = uploadResult.secure_url;
                    livePhotoPublicIdDb = uploadResult.public_id;
                    successfullyProcessedOriginalPaths.push(livePhotoTempPath); 
                } else {
                    throw new Error('Не вдалося завантажити "живе" фото в Cloudinary.');
                }
            } catch (livePhotoError) {
                console.error(`[Admin Routes] POST: Помилка завантаження "живого" фото ${livePhotoFile.originalname}:`, livePhotoError.message);
                try { await fs.unlink(livePhotoTempPath); } catch(e) { /* ігнор */ }
            }
        }

        const processedTags = tags ? tags.split(',').map(tag => tag.trim()).filter(tag => tag) : [];
        const processedMaterials = materials ? materials.split(',').map(m => m.trim()).filter(m => m) : [];
        const processedColors = colors ? colors.split(',').map(c => c.trim()).filter(c => c) : [];

const newProduct = new Product({
    name, description, metaDescription: metaDescription ? metaDescription.trim() : null,
    price: numPrice, 
    maxPrice: (numMaxPrice !== null && numMaxPrice >= numPrice) ? numMaxPrice : undefined,
    category, status: status || 'Під замовлення', images: processedImagesData,
    livePhotoUrl: livePhotoUrlDb,
    livePhotoPublicId: livePhotoPublicIdDb,
    tags: processedTags, materials: processedMaterials, colors: processedColors,
    care_instructions, creation_time_info, isFeatured: isFeatured === 'on', csrfToken: req.csrfToken()
});

if (sku && sku.trim() !== '') {
    newProduct.sku = sku.trim();
}

        await newProduct.save();

        for (const pathToDelete of successfullyProcessedOriginalPaths) {
            try {
                await fs.unlink(pathToDelete);
            } catch (unlinkError) {
                console.warn(`[Admin Routes] Не вдалося видалити тимчасовий файл ${pathToDelete}:`, unlinkError.message);
            }
        }
        res.redirect('/admin/products');
    } catch (error) { 
        console.error('[Admin Routes] Загальна помилка в POST /admin/products (зовнішній catch):', error.message, error.stack);
        
        const allTempFilesPaths = mainImageFiles.map(f => f.path);
        if (livePhotoFile && livePhotoFile.path) { 
            allTempFilesPaths.push(livePhotoFile.path);
        }
        const pathsToAttemptDelete = allTempFilesPaths.filter(p => !successfullyProcessedOriginalPaths.includes(p));

        if (pathsToAttemptDelete.length > 0) {
            console.log('[Admin Routes] Спроба очищення залишених тимчасових файлів через загальну помилку...');
            await Promise.all(pathsToAttemptDelete.map(filePath => {
                return fs.unlink(filePath)
                    .then(() => console.log(`[Admin Routes] Тимчасовий файл ${filePath} видалено (загальна помилка).`))
                    .catch(e => console.warn(`[Admin Routes] Не вдалося видалити ${filePath} (загальна помилка):`, e.message));
            }));
        }
        if (error.name === 'ValidationError') {
            let errorMsg = 'Помилка валідації: ';
            for (let field in error.errors) { errorMsg += `${error.errors[field].message} `; }
            return res.status(400).render('admin/new-product', {
                pageTitle: 'Помилка - Додати Товар', categories, formData, error: errorMsg.trim(), csrfToken: req.csrfToken()
            });
        }
        return res.status(500).render('admin/new-product', {
            pageTitle: 'Помилка - Додати Товар', categories, formData,
            error: error.message || 'Сталася невідома помилка при обробці зображень.', csrfToken: req.csrfToken()
        });
    }
});


router.get('/products/:id/edit', checkAdminAuth, csrfProtection, async (req, res, next) => {
    try {
        const product = await Product.findById(req.params.id).lean();
        if (!product) return res.redirect('/admin/products?error=notfound');
        
        res.render('admin/edit-product', {
            pageTitle: `Редагувати: ${product.name}`,
            productData: product,
            categories: ['Вишивка'],
            errorMessage: req.query.error ? decodeURIComponent(req.query.error) : null,
            pageName: 'products',
            csrfToken: req.csrfToken()
        });
    } catch (error) {
        console.error('[Admin Routes] Помилка отримання товару для редагування:', error);
        next(error);
    }
});

router.put('/products/:id', checkAdminAuth, cpUpload, csrfProtection, async (req, res, next) => {
    const productId = req.params.id;
    const categories = ['Вишивка'];
    let productToUpdate;

    const newMainImageTempPaths = req.files && req.files.imageFiles ? req.files.imageFiles.map(f => f.path) : [];
    const newLivePhotoTempPath = req.files && req.files.livePhotoFile && req.files.livePhotoFile[0] ? req.files.livePhotoFile[0].path : null;
    
    let successfullyProcessedNewMainPaths = [];
    let successfullyProcessedNewLivePath = null;
    let tempUploadedFilePaths = [...newMainImageTempPaths];
    if (newLivePhotoTempPath) {
        tempUploadedFilePaths.push(newLivePhotoTempPath);
    }

    const mainImagesReceived = req.files && req.files.imageFiles ? req.files.imageFiles : [];
    const livePhotoReceived = req.files && req.files.livePhotoFile ? req.files.livePhotoFile[0] : null;

    try {
        if (!mongoose.Types.ObjectId.isValid(productId)) {
            if (newMainImageTempPaths.length > 0) await Promise.all(newMainImageTempPaths.map(p => fs.unlink(p).catch(e => {})));
            if (newLivePhotoTempPath) await fs.unlink(newLivePhotoTempPath).catch(e => {});
            return res.redirect(`/admin/products?error=invalid_id_update`);
        }

        productToUpdate = await Product.findById(productId);
        if (!productToUpdate) {
            if (newMainImageTempPaths.length > 0) await Promise.all(newMainImageTempPaths.map(p => fs.unlink(p).catch(e => {})));
            if (newLivePhotoTempPath) await fs.unlink(newLivePhotoTempPath).catch(e => {});
            return res.redirect(`/admin/products?error=notfound_update`);
        }
        
const {
    name, description, price, maxPrice, category,
    tags, materials, colors, care_instructions, isFeatured,
    creation_time_info, status, metaDescription,
    images_to_delete, delete_live_photo,
    sku 
} = req.body;

        if (!name || !description || !price || !category || !creation_time_info || !status) {
            if (newMainImageTempPaths.length > 0) await Promise.all(newMainImageTempPaths.map(p=>fs.unlink(p).catch(e=>{})));
            if (newLivePhotoTempPath) await fs.unlink(newLivePhotoTempPath).catch(e=>{});
           return res.redirect(`/admin/products/${productId}/edit?error=${encodeURIComponent('Будь ласка, заповніть усі обов\'язкові поля.')}`);
        }

        productToUpdate.name = name;
        productToUpdate.description = description;
        productToUpdate.metaDescription = metaDescription ? metaDescription.trim() : null;
        productToUpdate.sku = sku ? sku.trim() : null;
        
        let currentNumPrice = parseFloat(price) || 0;
        let currentNumMaxPrice = maxPrice ? (parseFloat(maxPrice) || null) : null;

        productToUpdate.price = currentNumPrice;
        productToUpdate.maxPrice = (currentNumMaxPrice !== null && currentNumMaxPrice >= currentNumPrice) ? currentNumMaxPrice : undefined;
       
        if (currentNumMaxPrice !== null && currentNumPrice > currentNumMaxPrice) {
             if (newMainImageTempPaths.length > 0) await Promise.all(newMainImageTempPaths.map(p=>fs.unlink(p).catch(e=>{})));
             if (newLivePhotoTempPath) await fs.unlink(newLivePhotoTempPath).catch(e=>{});
            return res.redirect(`/admin/products/${productId}/edit?error=price_validation`);
        }
        productToUpdate.category = category;
        productToUpdate.status = status;
        productToUpdate.tags = tags ? tags.split(',').map(tag => tag.trim()).filter(tag => tag) : [];
        productToUpdate.materials = materials ? materials.split(',').map(m => m.trim()).filter(m => m) : [];
        productToUpdate.colors = colors ? colors.split(',').map(c => c.trim()).filter(c => c) : [];
        productToUpdate.care_instructions = care_instructions;
        productToUpdate.creation_time_info = creation_time_info;
        productToUpdate.isFeatured = isFeatured === 'on';

        let newCloudinaryImagesData = []; 

        if (mainImagesReceived.length > 0) {
            for (const file of mainImagesReceived) {
                const originalPath = file.path; 
                const baseFilename = path.parse(file.filename).name;
                const imageSetUrlsAndIds = { large: null, medium: null, thumb: null };
                try {
                    const imageBuffer = await fs.readFile(originalPath);
                    const imageProcessor = sharp(imageBuffer).rotate(); 
                    const sizes = { large: { width: 1000, quality: 80 }, medium: { width: 600, quality: 75 }, thumb: { width: 300, quality: 70 } };
                    for (const [sizeName, options] of Object.entries(sizes)) {
                        const processedBuffer = await imageProcessor.clone().resize({ width: options.width, withoutEnlargement: true }).webp({ quality: options.quality }).toBuffer();
                        const publicIdForUpload = `${baseFilename}-${sizeName}-${Date.now()}`;
                        const uploadResult = await new Promise((resolve, reject) => {
                            cloudinary.uploader.upload_stream(
                                { folder: "products", public_id: publicIdForUpload, resource_type: "image", format: "webp" },
                                (error, result) => error ? reject(error) : resolve(result)
                            ).end(processedBuffer);
                        });
                        if (!uploadResult || !uploadResult.secure_url || !uploadResult.public_id) {
                            throw new Error(`Помилка завантаження ${sizeName} для ${file.originalname}`);
                        }
                        imageSetUrlsAndIds[sizeName] = { url: uploadResult.secure_url, public_id: uploadResult.public_id };
                    }
                    if (imageSetUrlsAndIds.large && imageSetUrlsAndIds.medium && imageSetUrlsAndIds.thumb) {
                        newCloudinaryImagesData.push(imageSetUrlsAndIds);
                        successfullyProcessedNewMainPaths.push(originalPath); 
                    } else {
                         try { await fs.unlink(originalPath); } catch (e) { /* ігнор */ }
                    }
                } catch (fileProcessingError) {
                    console.error(`[Admin Routes] PUT: Помилка обробки нового основного файлу ${file.originalname}:`, fileProcessingError.message);
                    try { await fs.unlink(originalPath); } catch (e) { /* ігнор */ }
                }
            }
        }
        
        let finalImagesArray = [];
        if (productToUpdate.images && Array.isArray(productToUpdate.images)) {
            finalImagesArray = productToUpdate.images.filter(imgSet => {
                if (!imgSet || typeof imgSet !== 'object' || 
                    !imgSet.large || !imgSet.medium || !imgSet.thumb ||
                    !imgSet.large.public_id || !imgSet.medium.public_id || !imgSet.thumb.public_id) {
                    console.warn('[Admin Routes] PUT: Пропускаємо невалідний imageSet в існуючих зображеннях:', imgSet);
                    return false; 
                }

                const currentSetIds = [
                    imgSet.large.public_id, 
                    imgSet.medium.public_id, 
                    imgSet.thumb.public_id
                ];

                if (images_to_delete && images_to_delete.length > 0) {
                     const publicIdsToRemove = Array.isArray(images_to_delete) ? images_to_delete : [images_to_delete];
                     const shouldDeleteThisSet = publicIdsToRemove.some(idTriple => {
                        const idsInTriple = idTriple.split(',');
                        return idsInTriple.some(idToDel => currentSetIds.includes(idToDel.trim()));
                     });
                     if (shouldDeleteThisSet) {
                         currentSetIds.forEach(async (id) => {
                             try { 
                                 console.log(`[Admin Routes] PUT: Спроба видалення старого зображення ${id} з Cloudinary.`);
                                 await cloudinary.uploader.destroy(id); 
                                 console.log(`[Admin Routes] PUT: Зображення ${id} видалено з Cloudinary.`);
                             } catch (e) { console.error(`[Admin Routes] PUT: Помилка видалення зображення ${id} з Cloudinary:`, e.message);}
                         });
                         return false; 
                     }
                }
                return true; 
            });
        }

        finalImagesArray.push(...newCloudinaryImagesData);
        
        if (finalImagesArray.length === 0) {
            if (newMainImageTempPaths.length > 0) await Promise.all(newMainImageTempPaths.map(p=>fs.unlink(p).catch(e=>{})));
            if (newLivePhotoTempPath) await fs.unlink(newLivePhotoTempPath).catch(e=>{});

            const productDataForForm = await Product.findById(productId).lean() || req.body; 
            return res.render('admin/edit-product', {
                pageTitle: `Помилка - Редагувати: ${productDataForForm.name || 'Товар'}`,
                productData: productDataForForm,
                categories: categories,
                errorMessage: 'Має бути хоча б одне основне зображення товару. Якщо ви видалили всі старі, завантажте нові.',
                csrfToken: req.csrfToken() // <--- ДОБАВЛЕНО ЗДЕСЬ
            });
        }
        productToUpdate.images = finalImagesArray;


        if (livePhotoReceived) {
            if (productToUpdate.livePhotoPublicId) {
                try { await cloudinary.uploader.destroy(productToUpdate.livePhotoPublicId, { resource_type: productToUpdate.livePhotoUrl && productToUpdate.livePhotoUrl.endsWith('.gif') ? 'image' : 'video' }); } 
                catch (e) { console.error(`[Admin Routes] PUT: Помилка видалення старого live photo:`, e.message); }
            }
            try {
                const liveUploadResult = await cloudinary.uploader.upload(livePhotoReceived.path, {
                    folder: "products/live_photos",
                    resource_type: livePhotoReceived.mimetype.startsWith('image/gif') ? "image" : "video",
                });
                productToUpdate.livePhotoUrl = liveUploadResult.secure_url;
                productToUpdate.livePhotoPublicId = liveUploadResult.public_id;
                successfullyProcessedNewLivePath = livePhotoReceived.path;
            } catch (livePhotoError) {
                console.error(`[Admin Routes] PUT: Помилка завантаження нового live photo:`, livePhotoError.message);
                if (livePhotoReceived.path) try { await fs.unlink(livePhotoReceived.path); } catch (e) { /* ігнор */ }
            }
        } else if (delete_live_photo === 'true') {
            if (productToUpdate.livePhotoPublicId) {
                try { 
                    await cloudinary.uploader.destroy(productToUpdate.livePhotoPublicId, { resource_type: productToUpdate.livePhotoUrl && productToUpdate.livePhotoUrl.endsWith('.gif') ? 'image' : 'video' }); 
                    productToUpdate.livePhotoUrl = null; 
                    productToUpdate.livePhotoPublicId = null;
                } 
                catch (e) { console.error(`[Admin Routes] PUT: Помилка видалення live photo за запитом:`, e.message); }
            }
        }
        
        productToUpdate.markModified('images');
        if (livePhotoReceived || delete_live_photo === 'true') {
            productToUpdate.markModified('livePhotoUrl');
            productToUpdate.markModified('livePhotoPublicId');
        }

        if (sku && sku.trim() !== '') {
    productToUpdate.sku = sku.trim();
} else {
    productToUpdate.sku = undefined;
}

        const savedProduct = await productToUpdate.save(); 
        console.log(`[Admin Routes] PUT: Товар ${productId} успішно оновлено.`);

        if (successfullyProcessedNewMainPaths.length > 0) {
            await Promise.all(successfullyProcessedNewMainPaths.map(p => fs.unlink(p).catch(e => {})));
        }
        if (successfullyProcessedNewLivePath) {
             await fs.unlink(successfullyProcessedNewLivePath).catch(e => {});
        }
        const remainingTempFilesAfterProcessing = tempUploadedFilePaths.filter(p => 
            !successfullyProcessedNewMainPaths.includes(p) && 
            p !== successfullyProcessedNewLivePath
        );
        if(remainingTempFilesAfterProcessing.length > 0) {
            await Promise.all(remainingTempFilesAfterProcessing.map(p => fs.unlink(p).catch(e => {})));
        }
        
        res.redirect('/admin/products');

    } catch (error) { 
        console.error(`[Admin Routes] Загальна помилка в PUT /products/${productId}:`, error.message, error.stack);
        const allTempPathsForCleanupOnError = [...newMainImageTempPaths];
        if (newLivePhotoTempPath && !allTempPathsForCleanupOnError.includes(newLivePhotoTempPath)) {
            allTempPathsForCleanupOnError.push(newLivePhotoTempPath);
        }
        
        if (allTempPathsForCleanupOnError.length > 0) {
            await Promise.all(allTempPathsForCleanupOnError.map(p => fs.unlink(p).catch(e => {})));
        }
        
        let errorMsgForRender = 'Сталася невідома помилка при оновленні товару.';
        if (error.name === 'ValidationError') {
            if (error.errors && error.errors.images) {
                 errorMsgForRender = error.errors.images.message;
            } else {
                 errorMsgForRender = 'Помилка валідації: ' + Object.values(error.errors).map(el => el.message).join(' ');
            }
        } else if (error.message) {
            errorMsgForRender = error.message;
        }

        const productDataForForm = await Product.findById(productId).lean() || req.body;
        
        return res.render('admin/edit-product', {
            pageTitle: `Помилка - Редагувати: ${productDataForForm.name || 'Товар'}`,
            productData: productDataForForm,
            categories: categories,
            errorMessage: errorMsgForRender,
            csrfToken: req.csrfToken() // <--- И ДОБАВЛЕНО ЗДЕСЬ
        });
    }
});


router.post('/products/:id/delete', checkAdminAuth,  csrfProtection, async (req, res, next) => {
    const productId = req.params.id;
    try {
        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return res.redirect('/admin/products?error=invalid_id_delete');
        }
        const productToDelete = await Product.findById(productId);
        if (!productToDelete) {
            return res.redirect('/admin/products?error=notfound_delete');
        }

        if (productToDelete.images && productToDelete.images.length > 0) {
            for (const imgSet of productToDelete.images) {
                const publicIdsToDelete = [];
                if (imgSet.large && imgSet.large.public_id) publicIdsToDelete.push(imgSet.large.public_id);
                if (imgSet.medium && imgSet.medium.public_id) publicIdsToDelete.push(imgSet.medium.public_id);
                if (imgSet.thumb && imgSet.thumb.public_id) publicIdsToDelete.push(imgSet.thumb.public_id);
                
                for (const publicId of publicIdsToDelete) {
                    try {
                        console.log(`[Admin Routes] Спроба видалення з Cloudinary: ${publicId}`);
                        const result = await cloudinary.uploader.destroy(publicId);
                        console.log(`[Admin Routes] Зображення ${publicId} видалено з Cloudinary:`, result);
                    } catch (cloudinaryError) {
                        console.error(`[Admin Routes] Помилка видалення зображення ${publicId} з Cloudinary:`, cloudinaryError.message);
                    }
                }
            }
        }
        if (productToDelete.livePhotoPublicId) {
            try {
                await cloudinary.uploader.destroy(productToDelete.livePhotoPublicId, { resource_type: productToDelete.livePhotoUrl && productToDelete.livePhotoUrl.endsWith('.gif') ? 'image' : 'video' });
                console.log(`[Admin Routes] "Живе" фото ${productToDelete.livePhotoPublicId} видалено з Cloudinary.`);
            } catch (e) {
                console.error(`[Admin Routes] Помилка видалення "живого" фото ${productToDelete.livePhotoPublicId} з Cloudinary:`, e.message);
            }
        }

        await Product.findByIdAndDelete(productId);
        console.log(`[Admin Routes] Товар ${productId} успішно видалено з БД.`);
        res.redirect('/admin/products');
    } catch (error) {
        console.error(`[Admin Routes] Помилка видалення товару ${productId}:`, error);
        next(error);
    }
});

router.post('/generate-meta-description', checkAdminAuth,  csrfProtection, async (req, res) => {
    const { productName, productDescription } = req.body;

    if (!productName || !productDescription) {
        return res.status(400).json({ message: 'Назва та опис товару необхідні для генерації.' });
    }
    if (!process.env.GEMINI_API_KEY) {
        console.error('[AI Meta Gen] GEMINI_API_KEY не знайдено в .env');
        return res.status(500).json({ message: 'Сервіс генерації тимчасово недоступний (відсутній API ключ).' });
    }

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash", 
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            ]
        });

      const prompt = `Ти — копірайтер для української майстерні ручної роботи 'Вузлик до вузлика'.
Твоє завдання — створити емоційний та SEO-оптимізований мета-опис для товару.

Дані:
- Назва товару: "${productName}"
- Опис товару: "${productDescription}"

Вимоги до мета-опису:
- **Тон:** Пиши тепло, душевно, підкреслюючи унікальність та тепло ручної роботи.
- **Ключові слова:** Обов'язково використай ключові слова: "ручна робота", "вишивка", "купити в Україні". Інтегруй їх органічно в речення.
- **Заклик до дії (CTA):** Заверши опис чітким, але ненав'язливим закликом до дії (наприклад, "Замовляйте онлайн!", "Відкрийте для себе красу традицій!", "Дізнайтесь більше на сайті.").
- **Довжина:** Дуже важливо! Суворо дотримуйся довжини від 140 до 158 символів. Це потрібно, щоб опис не обрізався в пошуковій видачі.
- **Унікальність:** Уникай прямого повторення назви товару, якщо вона довга. Краще перефразуй або використай її частину.
- **Чого уникати:** Не використовуй шаблонні, бездушні фрази. Не закінчуй опис трьома крапками (...) або обірваним реченням.

Приклад гарного опису: "✨ Відкрийте для себе унікальну вишиванку ручної роботи 'Лісова пісня'. Ексклюзивний подарунок з душею. 🌿 Купити з доставкою по Україні. Замовляйте!"

Результат:
Надай відповідь **тільки текстом** мета-опису, без жодних додаткових пояснень, лапок, заголовків чи фрази "Ось мета-опис:".`;

        const result = await model.generateContent(prompt);
        const response = result.response;
        let aiResponseText = response.text(); 

        console.log(`[AI Meta Gen - Product] Raw AI response: ${aiResponseText}`);
        
        let generatedMetaDescription = '';

        if (aiResponseText.startsWith("```json")) { 
            aiResponseText = aiResponseText.substring(7);
        } else if (aiResponseText.startsWith("```")) { 
             aiResponseText = aiResponseText.substring(3);
        }
        if (aiResponseText.endsWith("```")) {
            aiResponseText = aiResponseText.substring(0, aiResponseText.length - 3);
        }
        generatedMetaDescription = aiResponseText.trim();


        if (!generatedMetaDescription || generatedMetaDescription.trim() === '') {
            generatedMetaDescription = `Купуйте ексклюзивну вишивку "${productName}" ручної роботи. ${productDescription.substring(0, 60)}... Детальніше на сайті!`;
            console.warn('[AI Meta Gen - Product] AI returned empty or invalid text, using fallback.');
        }
        
        if (generatedMetaDescription.length > 160) {
            generatedMetaDescription = generatedMetaDescription.substring(0, 160).trim();
            const lastSpace = generatedMetaDescription.lastIndexOf(' ', 157); 
            if (lastSpace > 0) {
                generatedMetaDescription = generatedMetaDescription.substring(0, lastSpace) + "...";
            } else { 
                 generatedMetaDescription = generatedMetaDescription.substring(0, 157) + "...";
            }
        }

        console.log(`[AI Meta Gen - Product] productName: ${productName}`);
        console.log(`[AI Meta Gen - Product] Generated: ${generatedMetaDescription}`);

        res.json({ metaDescription: generatedMetaDescription.trim() });

    } catch (error) {
        console.error('[Admin Routes] Помилка генерації мета-опису для товару:', error);
        let userMessage = 'Не вдалося згенерувати мета-опис.';
        if (error.message.includes('SAFETY')) {
            userMessage = 'Генерація була заблокована через налаштування безпеки. Спробуйте змінити текст.';
        } else if (error.message.includes('API key not valid')) {
             userMessage = 'Помилка конфігурації AI: недійсний API ключ.';
        }
        res.status(500).json({ message: userMessage });
    }
});


module.exports = router;