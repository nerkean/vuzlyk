require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const session = require('express-session');
const compression = require('compression');
const nodemailer = require('nodemailer');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const MongoStore = require('connect-mongo');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const methodOverride = require('method-override');
const helmet = require('helmet');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
const { SitemapStream, streamToPromise } = require('sitemap');
const { Readable } = require('stream');
const NodeCache = require('node-cache');

const User = require('./models/User');
const Product = require('./models/Product');
const Order = require('./models/Order');
const Post = require('./models/Post');
const Category = require('./models/Category');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegramOrderNotification(order) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.warn('[Telegram] TELEGRAM_BOT_TOKEN або TELEGRAM_CHAT_ID не задані. Сповіщення не відправлено.');
        return;
    }

    try {
        const itemsText = (order.items || [])
            .map(item => `• ${item.name} — ${item.quantity} шт × ${item.price}₴`)
            .join('\n') || '—';

        const lines = [
            '🧵 НОВЕ ЗАМОВЛЕННЯ НА Vuzlyk',
            '',
            `ID: ${order._id}`,
            `Імʼя: ${order.contactInfo?.name || '—'}`,
            `Телефон: ${order.contactInfo?.phone || '—'}`,
            `Email: ${order.contactInfo?.email || '—'}`,
            '',
            `Доставка: ${order.shipping?.method || '—'}`,
            order.shipping?.city ? `Місто: ${order.shipping.city}` : null,
            order.shipping?.warehouse ? `Відділення: ${order.shipping.warehouse}` : null,
            order.shipping?.address ? `Адреса: ${order.shipping.address}` : null,
            '',
            'Товари:',
            itemsText,
            '',
            `Сума: ${order.totalAmount}₴`,
            order.comments && order.comments !== 'Немає'
                ? `\nКоментар клієнта: ${order.comments}`
                : null,
        ].filter(Boolean);

        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: lines.join('\n')
        });

        console.log('[Telegram] Повідомлення про замовлення успішно відправлено.');
    } catch (err) {
        console.error('[Telegram] Помилка відправки повідомлення:', err.message);
    }
}

const app = express();

const cache = new NodeCache({ stdTTL: 300, checkperiod: 120 });

app.set('trust proxy', 1);
const PORT = process.env.PORT || 5500;
const DB_URI = process.env.MONGODB_URI;

mongoose.connect(DB_URI)
    .then(() => console.log('Успішно підключено до MongoDB'))
    .catch(err => console.error('Помилка підключення до MongoDB:', err));

mongoose.connection.on('error', err => {
    console.error('Помилка з\'єднання MongoDB:', err);
});

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(compression());
app.use(express.static(path.join(__dirname, 'public')));

if (process.env.NODE_ENV === 'production') {
  app.use('/dist', express.static(path.join(__dirname, 'public', 'dist'), {
    immutable: true,
    maxAge: '1y' 
  }));

  app.use('/fonts', express.static(path.join(__dirname, 'public', 'fonts'), {
    immutable: true,
    maxAge: '1y'
  }));
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(methodOverride('_method'));
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                ...helmet.contentSecurityPolicy.getDefaultDirectives(),
                "script-src": [
                    "'self'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://unpkg.com",
                    "https://www.googletagmanager.com", "https://www.google-analytics.com", "https://ssl.google-analytics.com",
                    "https://maps.googleapis.com", "https://maps.gstatic.com", "*.google.com", "*.google.com.ua",
                    "*.googleadservices.com", "https://www.googleadservices.com", "*.doubleclick.net",
                    "https://tpc.googlesyndication.com", "https://pagead2.googlesyndication.com",
                    "https://cdn.tailwindcss.com", "https://www.google.com/recaptcha/", "https://www.gstatic.com",
                    "'unsafe-inline'"
                ],
                "script-src-attr": ["'unsafe-inline'"],
                "style-src": [
                    "'self'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com",
                    "https://unpkg.com", "https://fonts.gstatic.com", "https://maps.googleapis.com", "'unsafe-inline'"
                ],
                "font-src": ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com", "https://maps.gstatic.com", "data:"],
                "img-src": [
                    "'self'", "data:", "https://res.cloudinary.com", "https://www.google-analytics.com", "*.google.com",
                    "https://www.google.com", "https://www.google.com.ua", "*.google.com.ua", "*.googleadservices.com",
                    "https://www.googleadservices.com", "*.doubleclick.net", "*.googlesyndication.com",
                    "https://pagead2.googlesyndication.com", "https://googleads.g.doubleclick.net",
                    "https://www.googletagmanager.com", "https://maps.googleapis.com", "https://maps.gstatic.com",
                    "https://csi.gstatic.com", "maps.google.com", "https://www.gstatic.com"
                ],
                "media-src": ["'self'", "https://res.cloudinary.com"],
                "connect-src": [
                    "'self'", "https://res.cloudinary.com", "https://www.google-analytics.com", "*.google-analytics.com",
                    "https://www.googletagmanager.com", "*.google.com", "https://www.google.com", "https://www.google.com.ua",
                    "*.google.com.ua", "*.googleadservices.com", "https://www.googleadservices.com", "*.doubleclick.net",
                    "*.googlesyndication.com", "https://pagead2.googlesyndication.com", "https://googleads.g.doubleclick.net",
                    "https://maps.googleapis.com", "https://maps.google.com", "*.cerebrospinal.googleapis.com", "https://www.gstatic.com",
                    "https://api.novaposhta.ua"
                ],
                "frame-src": [
                    "'self'", "https://www.googletagmanager.com", "*.google.com", "https://maps.google.com",
                    "*.doubleclick.net", "https://bid.g.doubleclick.net", "https://www.google.com/recaptcha/",
                    "https://recaptcha.google.com/"
                ],
                "object-src": ["'none'"],
                "worker-src": ["'self'"],
                "form-action": ["'self'"],
            }
        },
        crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
        crossOriginEmbedderPolicy: { policy: "unsafe-none" },
        referrerPolicy: { policy: "strict-origin-when-cross-origin" },
        hsts: {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true
        }
    })
);

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: DB_URI,
        collectionName: 'sessions',
        ttl: 60 * 60 * 24 * 7 
    }),
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 24 * 7, 
        httpOnly: true
    }
}));

app.use(passport.initialize());
app.use(passport.session());

const csrfProtection = csrf({ cookie: true });

if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
        if (req.headers['x-forwarded-proto'] !== 'https') {
            return res.redirect(['https://', req.get('Host'), req.originalUrl].join(''));
        }
        next();
    });
}

passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
    try {
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) { return done(null, false, { message: 'Неправильний email або пароль.' }); }
        const isMatch = await user.comparePassword(password);
        if (!isMatch) { return done(null, false, { message: 'Неправильний email або пароль.' }); }
        return done(null, user);
    } catch (error) {
        return done(error);
    }
}));

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback",
    passReqToCallback: true
}, async (req, accessToken, refreshToken, profile, done) => {
    try {
        let user = await User.findOne({ googleId: profile.id });
        if (user) { return done(null, user); }
        
        const email = profile.emails?.[0]?.value;
        if (!email) { return done(null, false, { message: 'Не вдалося отримати email від Google.' }); }
        
        const newUser = new User({
            googleId: profile.id,
            email: email.toLowerCase(),
            name: profile.displayName || 'Google User',
            profilePicture: profile.photos?.[0]?.value
        });
        await newUser.save();
        return done(null, newUser);
    } catch (error) {
        return done(error, false);
    }
}));

passport.serializeUser((user, done) => { done(null, user.id); });
passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

const AVAILABLE_CURRENCIES = ['UAH', 'EUR', 'USD'];
const EXCHANGE_RATES = { UAH: 1, USD: 1 / 41.0, EUR: 1 / 46.8 };
const CURRENCY_SYMBOLS = { UAH: '₴', USD: '$', EUR: '€' };
let currentRates = { ...EXCHANGE_RATES };

async function fetchAndUpdateRates() {
    try {
        const response = await axios.get('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json');
        const nbuRates = response.data;
        const usdRate = nbuRates.find(rate => rate.cc === 'USD')?.rate;
        const eurRate = nbuRates.find(rate => rate.cc === 'EUR')?.rate;
        if (usdRate && eurRate) {
            currentRates = { UAH: 1, USD: 1 / usdRate, EUR: 1 / eurRate };
        }
    } catch (error) {
        console.error('[ERROR] Помилка отримання курсів валют:', error.message);
    }
}
fetchAndUpdateRates();
setInterval(fetchAndUpdateRates, 6 * 60 * 60 * 1000);

app.use(async (req, res, next) => {
    let currentCurrency = 'UAH';
    const queryCurrency = req.query.currency?.toUpperCase();
    if (queryCurrency && AVAILABLE_CURRENCIES.includes(queryCurrency)) {
        req.session.currency = queryCurrency;
        currentCurrency = queryCurrency;
    } else if (req.session.currency && AVAILABLE_CURRENCIES.includes(req.session.currency)) {
        currentCurrency = req.session.currency;
    }
    const currentIndex = AVAILABLE_CURRENCIES.indexOf(currentCurrency);
    const nextIndex = (currentIndex + 1) % AVAILABLE_CURRENCIES.length;

    try {
        const CACHE_TTL_CATEGORIES = 3600; 
        let categories = cache.get('categories');

        if (!categories) {
            const baseCategories = await Category.find().sort('order').lean();
            
            categories = await Promise.all(baseCategories.map(async (cat) => {
                const catCopy = { ...cat };
                const randomProducts = await Product.aggregate([
                    { $match: { category: cat.name } },
                    { $sample: { size: 1 } }
                ]);
                
                if (randomProducts && randomProducts.length > 0 && randomProducts[0].images && randomProducts[0].images.length > 0) {
                    const imgSet = randomProducts[0].images[0];
                    catCopy.image = imgSet.medium?.url || imgSet.large?.url || imgSet.thumb?.url || '/images/placeholder.svg';
                } else {
                    catCopy.image = '/images/placeholder.svg'; 
                }
                return catCopy;
            }));

            cache.set('categories', categories, CACHE_TTL_CATEGORIES);
        }
        res.locals.categories = categories;

    } catch (error) {
        console.error("Ошибка получения категорий для хедера:", error);
        res.locals.categories = [];
    }

    if (req.user) {
        try {
            const userWithWishlist = await User.findById(req.user._id, 'wishlist').lean(); 
            res.locals.wishlistIds = new Set(userWithWishlist.wishlist.map(id => id.toString()));
        } catch (error) {
            res.locals.wishlistIds = new Set();
        }
    } else {
        res.locals.wishlistIds = new Set();
    }

    res.locals.currentUser = req.user;
    res.locals.isAdmin = req.session.isAdmin || false;
    res.locals.cartItemCount = req.session.cart ? req.session.cart.reduce((sum, item) => sum + (item.quantity || 0), 0) : 0;
    res.locals.selectedCurrency = currentCurrency;
    res.locals.exchangeRates = currentRates;
    res.locals.currencySymbols = CURRENCY_SYMBOLS;
    res.locals.nextCurrency = AVAILABLE_CURRENCIES[nextIndex];
    res.locals.gaMeasurementId = process.env.GA_MEASUREMENT_ID;
    res.locals.googleMapsApiKey = process.env.Maps_API_KEY;
    res.locals.reCaptchaV2SiteKey = process.env.RECAPTCHA_V2_SITE_KEY;
    res.locals.isProduction = process.env.NODE_ENV === 'production';
    res.locals.formatPrice = app.locals.formatPrice;
    res.locals.baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    next();
});

function isLoggedIn(req, res, next) {
  if (req.isAuthenticated()) {
      return next();
  }
  req.session.returnTo = req.originalUrl; 
  res.redirect('/login');
}

const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const blogAdminRoutes = require('./routes/blogAdminRoutes');
const blogRoutes = require('./routes/blogRoutes');

app.use('/', authRoutes);
app.use('/admin', adminRoutes);
app.use('/admin/blog', blogAdminRoutes);
app.use('/blog', blogRoutes);

app.get('/', csrfProtection, async (req, res, next) => {
    try {
        const CACHE_TTL_FEATURED = 1800;
        let featuredProducts = cache.get('featuredProducts');

        if (!featuredProducts) {
            featuredProducts = await Product.find({ isFeatured: true }).select('name price maxPrice images slug').limit(4).lean();
            cache.set('featuredProducts', featuredProducts, CACHE_TTL_FEATURED);
        }
        
        res.render('index', {
           featuredProducts: featuredProducts,
           canonicalUrl: res.locals.baseUrl + '/',
           pageName: 'home',
           query: req.query,
           success: req.query.success ? decodeURIComponent(req.query.success) : null,
           csrfToken: req.csrfToken()
        });
    } catch (error) {
        next(error);
    }
});

app.get('/product/:id', csrfProtection, async (req, res, next) => {
    const productId = req.params.id;
    try {
        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return res.status(404).render('404');
        }

        const cacheKey = `product_${productId}`;
        const cachedData = cache.get(cacheKey);
        
        if (cachedData) {
            return res.render('product-detail', {
                ...cachedData,
                csrfToken: req.csrfToken()
            });
        }

        const product = await Product.findById(productId).lean();
        
        if (!product) {
            return res.status(404).render('404');
        }

        const similarProducts = product.category ? await Product.find({ category: product.category, _id: { $ne: product._id } }).limit(4).lean() : [];
        const isCustomProduct = productId === process.env.CUSTOM_PRODUCT_ID;
        
        const pageTitle = product.metaTitle || `${product.name} - купити вишивку ручної роботи | Вузлик до вузлика`;
        const defaultMetaDesc = `Купуйте ексклюзивну вишивку '${product.name}' ручної роботи в майстерні Вузлик до вузлика. ${product.description.replace(/<[^>]*>?/gm, '').substring(0, 90)}... Деталі та ціна на сайті.`;
        const metaDescription = product.metaDescription || defaultMetaDesc.substring(0, 170);

        const baseUrl = res.locals.baseUrl;
        let descriptionForJsonLd = product.description?.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim() || '';

        const productSchema = {
            "@context": "https://schema.org/",
            "@type": "Product",
            "name": product.name,
            "description": descriptionForJsonLd,
            "image": product.images?.map(imgSet => new URL(imgSet.large.url, baseUrl).href) || [],
            "sku": product._id.toString(),
            "brand": {
                "@type": "Organization",
                "name": "Вузлик до вузлика",
                "url": baseUrl 
            },
            "offers": {
                "@type": "Offer",
                "url": `${baseUrl}/product/${product._id}`, 
                "priceCurrency": res.locals.selectedCurrency || "UAH",
                "price": (product.price * (res.locals.exchangeRates[res.locals.selectedCurrency || "UAH"] || 1)).toFixed(2),
                "availability": product.status === 'В наявності' ? "https://schema.org/InStock" : "https://schema.org/PreOrder",
                "itemCondition": "https://schema.org/NewCondition",
                "sku": product._id.toString() 
            }
        };

        const renderData = {
            product: product, 
            similarProducts: similarProducts, 
            isCustomProduct: isCustomProduct, 
            pageTitle: pageTitle, 
            metaDescription: metaDescription, 
            productLD: productSchema
        };
        cache.set(cacheKey, renderData, 300);

        res.render('product-detail', {
            ...renderData,
            csrfToken: req.csrfToken()
        });
    } catch (error) {
        next(error);
    }
});

app.get('/catalog', csrfProtection, async (req, res, next) => {
    if (req.query.category) {
        return next();
    }
    
    try {
        const categories = res.locals.categories; 
        res.render('categories', {
            pageTitle: 'Наші Категорії | Вузлик до вузлика',
            metaDescription: 'Оберіть розділ каталогу, щоб знайти ідеальну вишивку чи аксесуар ручної роботи для себе або на подарунок. Ексклюзивні вироби від Вузлик до вузлика.',
            categories: categories,
            csrfToken: req.csrfToken()
        });
    } catch (error) {
        next(error);
    }
});

app.get('/catalog', csrfProtection, async (req, res, next) => {
    const page = parseInt(req.query.page) || 1;
    const limit = 12; 
    const sortOption = req.query.sort || 'default';
    const filters = {};
    if (req.query.price_from) filters.price_from = req.query.price_from;
    if (req.query.price_to) filters.price_to = req.query.price_to;
    if (req.query.status) filters.status = Array.isArray(req.query.status) ? req.query.status : [req.query.status];
    if (req.query.tags) filters.tags = Array.isArray(req.query.tags) ? req.query.tags : [req.query.tags];

    try {
        const cacheKey = `catalog_${JSON.stringify(req.query)}`;
        const cachedCatalog = cache.get(cacheKey);
        
        if (cachedCatalog) {
            return res.render('catalog', {
                ...cachedCatalog,
                originalUrl: req.originalUrl,
                query: req.query,
                csrfToken: req.csrfToken()
            });
        }

        const skip = (page - 1) * limit;
        const sortQuery = getSortQuery(sortOption); 

        const filterQuery = {}; 

        const { category } = req.query;
        let pageTitle = 'Каталог товарів ручної роботи';
        let pageHeading = 'Каталог товарів';
        let metaDescription = 'Перегляньте каталог унікальних виробів ручної роботи від майстерні "Вузлик до вузлика".';
        let categoryTags = []; 

        let selectedCategoryObj = null;
        if (category && category !== 'all') { 
            selectedCategoryObj = await Category.findOne({ slug: category }).lean();
        }

        if (selectedCategoryObj) {
            pageTitle = `Каталог: ${selectedCategoryObj.name} Ручної Роботи`;
            pageHeading = selectedCategoryObj.name;
            metaDescription = selectedCategoryObj.description || `Каталог унікальних виробів у категорії ${selectedCategoryObj.name}.`;
            filterQuery.category = selectedCategoryObj.name;

            categoryTags = await Product.distinct('tags', { category: selectedCategoryObj.name });
        } else {
            pageHeading = 'Усі товари';
            categoryTags = await Product.distinct('tags');
        }

        const [products, totalProducts] = await Promise.all([
            Product.find(filterQuery).sort(sortQuery).skip(skip).limit(limit).lean(),
            Product.countDocuments(filterQuery)
        ]);

        const totalPages = Math.ceil(totalProducts / limit);

        const firstProductImageUrl = (products.length > 0 && products[0].images && products[0].images.length > 0)
                                   ? (products[0].images[0].medium || products[0].images[0].thumb)
                                   : null;

        const renderData = {
            pageTitle: pageTitle,
            pageHeading: pageHeading,
            metaDescription: metaDescription,
            categoryTags: categoryTags.filter(Boolean), 
            products: products,
            currentPage: page,
            totalPages: totalPages,
            limit: limit,
            count: totalProducts, 
            firstProductImageUrl: firstProductImageUrl
        };

        cache.set(cacheKey, renderData, 300);

        res.render('catalog', {
            ...renderData,
            originalUrl: req.originalUrl,
            query: req.query,
            csrfToken: req.csrfToken()
        });
    } catch (error) {
        next(error);
    }
});

function getSortQuery(sortOption) {
    switch (sortOption) {
        case 'price_asc': return { price: 1 };
        case 'price_desc': return { price: -1 };
        case 'newest': return { createdAt: -1 };
        default: return { createdAt: -1 }; 
    }
}

app.post('/cart/add', async (req, res) => {
    const { productId, quantity } = req.body;
    const qty = parseInt(quantity) || 1;
    try {
        if (!req.session.cart) {
            req.session.cart = [];
        }
        const product = await Product.findById(productId).lean();

        if (!product) {
            return res.status(404).json({ success: false, message: 'Товар не знайдено' });
        }

        let imageForCart = '/images/placeholder.svg';
        if (product.images && product.images.length > 0) {
            const firstImageSet = product.images[0];
            if (firstImageSet.thumb && firstImageSet.thumb.url) { 
                imageForCart = firstImageSet.thumb.url; 
            } else if (firstImageSet.medium && firstImageSet.medium.url) { 
                imageForCart = firstImageSet.medium.url;
            }
        }

        const existingItemIndex = req.session.cart.findIndex(item => item.productId === productId);

        if (existingItemIndex > -1) {
            req.session.cart[existingItemIndex].quantity += qty;
            req.session.cart[existingItemIndex].image = imageForCart; 
            req.session.cart[existingItemIndex].price = product.price;
            req.session.cart[existingItemIndex].name = product.name;
        } else {
            req.session.cart.push({
                productId: productId,
                name: product.name,
                price: product.price,
                image: imageForCart,
                quantity: qty
            });
        }

        const newCartItemCount = req.session.cart.reduce((sum, item) => sum + item.quantity, 0);

        res.json({
            success: true,
            message: 'Товар додано до кошика',
            cartItemCount: newCartItemCount,
            selectedCurrency: res.locals.selectedCurrency,
            exchangeRates: res.locals.exchangeRates,
            currencySymbols: res.locals.currencySymbols
        });

    } catch (error) {
        res.status(500).json({ success: false, message: 'Помилка сервера' });
    }
});

app.get('/cart', csrfProtection, (req, res) => {
  const cart = req.session.cart || [];
  let subtotal = 0;
  const cartItemsForRender = cart.map(item => {
      const price = parseFloat(item.price);
      const quantity = parseInt(item.quantity);
      const validPrice = (typeof price === 'number' && isFinite(price) && price >= 0) ? price : 0;
      const validQuantity = (typeof quantity === 'number' && isFinite(quantity) && quantity >= 0) ? quantity : 0;
      const lineTotal = validPrice * validQuantity;
      subtotal += lineTotal;
      return {
          ...item,
          price: validPrice,
          quantity: validQuantity,
          lineTotal: lineTotal
      };
  }).filter(item => item && item.productId);
  const total = subtotal;
  res.render('cart', {
      pageTitle: 'Ваш кошик - Вузлик',
      cartItems: cartItemsForRender,
      subtotal: subtotal, 
      total: total,
      csrfToken: req.csrfToken()  
  });
});

app.post('/cart/update', (req, res) => {
  const { productId, quantity } = req.body;
  const newQuantity = parseInt(quantity);
  if (!req.session.cart || !productId || isNaN(newQuantity) || newQuantity < 1) {
      return res.status(400).json({ success: false, message: 'Неправильні дані запиту' });
  }
  const itemIndex = req.session.cart.findIndex(item => item.productId === productId);
  if (itemIndex > -1) {
      req.session.cart[itemIndex].quantity = newQuantity;
      let subtotal = 0;
      let itemLineTotal = 0;
      req.session.cart.forEach((item, index) => {
          const price = parseFloat(item.price) || 0;
          const quantity = parseInt(item.quantity) || 0;
          const currentLineTotal = price * quantity;
          item.lineTotal = currentLineTotal;
          subtotal += currentLineTotal;
          if (index === itemIndex) {
              itemLineTotal = currentLineTotal;
          }
      });
      const total = subtotal;
      const newCartItemCount = req.session.cart.reduce((sum, item) => sum + item.quantity, 0);
      res.json({
          success: true,
          message: 'Кількість оновлено',
          cartItemCount: newCartItemCount,
          itemLineTotal: itemLineTotal, 
          subtotal: subtotal,     
          total: total,         
          selectedCurrency: res.locals.selectedCurrency,
          exchangeRates: res.locals.exchangeRates,
          currencySymbols: res.locals.currencySymbols
      });
  } else {
      res.status(404).json({ success: false, message: 'Товар не знайдено в кошику' });
  }
});

app.post('/cart/remove', (req, res) => {
  const { productId } = req.body;
  if (!req.session.cart || !productId) {
      return res.status(400).json({ success: false, message: 'Неправильні дані запиту' });
  }
  req.session.cart = req.session.cart.filter(item => item.productId !== productId);
  let subtotal = 0;
  req.session.cart.forEach(item => {
      const price = parseFloat(item.price) || 0;
      const quantity = parseInt(item.quantity) || 0;
      subtotal += price * quantity;
  });
  const total = subtotal;
  const newCartItemCount = req.session.cart.reduce((sum, item) => sum + item.quantity, 0);
  res.json({
      success: true,
      message: 'Товар видалено',
      cartItemCount: newCartItemCount,
      subtotal: subtotal.toFixed(2),
      total: total.toFixed(2)
  });
});

app.get('/api/products', async (req, res) => {
    const rates = res.locals.exchangeRates || { UAH: 1, USD: 1/39.5, EUR: 1/41.0 };
    const filterCurrency = res.locals.selectedCurrency || 'UAH';

    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 12;
        const skip = (page - 1) * limit;
        const filterQuery = {};

        const filterCurrency = (req.query.currency || 'UAH').toUpperCase();
        const priceFromInput = req.query.price_from;
        const priceToInput = req.query.price_to;

        if (priceFromInput || priceToInput) {
            filterQuery.price = {};
            const rateFromUAH = rates[filterCurrency] || 1;
            const rateToUAH = rateFromUAH !== 0 ? (1 / rateFromUAH) : null;

            if (rateToUAH) {
                if (priceFromInput) {
                    const priceFromNum = parseFloat(priceFromInput);
                    if (!isNaN(priceFromNum)) {
                        filterQuery.price.$gte = Math.floor(priceFromNum * rateToUAH);
                    }
                }
                if (priceToInput) {
                    const priceToNum = parseFloat(priceToInput);
                    if (!isNaN(priceToNum)) {
                        filterQuery.price.$lte = Math.ceil(priceToNum * rateToUAH);
                    }
                }
            } else if (filterCurrency === 'UAH') {
                if (priceFromInput) {
                    const priceFromNum = parseInt(priceFromInput);
                    if (!isNaN(priceFromNum)) filterQuery.price.$gte = priceFromNum;
                }
                if (priceToInput) {
                    const priceToNum = parseInt(priceToInput);
                    if (!isNaN(priceToNum)) filterQuery.price.$lte = priceToNum;
                }
            } else {
                delete filterQuery.price;
            }

            if (Object.keys(filterQuery.price || {}).length === 0) {
                delete filterQuery.price;
            }
        }
        if (req.query.status) {
            const statuses = Array.isArray(req.query.status) ? req.query.status : [req.query.status];
            if (statuses.length > 0) {
                const mappedStatuses = statuses.map(s => s === 'available' ? 'В наявності' : (s === 'pid_zamovlennya' ? 'Під замовлення' : null)).filter(Boolean);
                if(mappedStatuses.length > 0) {
                    filterQuery.status = { $in: mappedStatuses };
                }
            }
        }
        if (req.query.tags) {
            const tags = Array.isArray(req.query.tags) ? req.query.tags : [req.query.tags];
            if (tags.length > 0) {
                filterQuery.tags = { $in: tags };
            }
        }
        if (req.query.category && typeof req.query.category === 'string') {
            const categorySlug = req.query.category.toLowerCase();
            
            const cat = await Category.findOne({ slug: categorySlug }).lean();
            if (cat) {
                filterQuery.category = cat.name;
            }
        }
        let sortQuery = {};
        const sortOption = req.query.sort || 'default';
        switch (sortOption) {
            case 'price_asc':
                sortQuery = { price: 1 };
                break;
            case 'price_desc':
                sortQuery = { price: -1 };
                break;
            case 'newest':
                sortQuery = { createdAt: -1 };
                break;
            default:
                sortQuery = {};
        }

        const cacheKey = `api_products_${JSON.stringify(req.query)}_${filterCurrency}`;
        const cachedAPI = cache.get(cacheKey);
        if (cachedAPI) {
            return res.json(cachedAPI);
        }

        const [totalProducts, products] = await Promise.all([
            Product.countDocuments(filterQuery),
            Product.find(filterQuery).sort(sortQuery).skip(skip).limit(limit).lean()
        ]);
        
        const responseData = {
            success: true,
            products: products,
            currentPage: page,
            totalPages: Math.ceil(totalProducts / limit),
            totalProducts: totalProducts
        };

        cache.set(cacheKey, responseData, 300);
        res.json(responseData);
    } catch (error) {
        res.status(500).json({ success: false, message: "Помилка сервера" });
    }
});

app.get('/api/search-suggestions', async (req, res) => {
    const query = req.query.q;
    if (!query || query.length < 2) {
        return res.json([]);
    }

    try {
        const searchQuery = new RegExp(query, 'i');
        const limit = 5; 

        const products = await Product.find(
            { name: searchQuery },
            'name slug images' 
        ).limit(limit).lean();

        const posts = await Post.find(
            { title: searchQuery, isPublished: true },
            'title slug imageUrl' 
        ).limit(limit).lean();

        const productResults = products.map(p => ({
            name: p.name,
            url: `/product/${p.slug || p._id}`,
            image: p.images?.[0]?.thumb?.url || '/images/placeholder.svg',
            type: 'product'
        }));

        const postResults = posts.map(p => ({
            name: p.title,
            url: `/blog/${p.slug}`,
            image: p.imageUrl || '/images/placeholder.svg',
            type: 'post'
        }));

        const combinedResults = [...productResults, ...postResults].slice(0, 7);

        res.json(combinedResults);

    } catch (error) {
        res.status(500).json([]);
    }
});

app.get('/search', csrfProtection, async (req, res, next) => {
    const query = req.query.q || '';

    try {
        const searchQuery = new RegExp(query, 'i');
        
        const products = await Product.find({ name: searchQuery }).lean();
        const posts = await Post.find({ title: searchQuery, isPublished: true }).lean();

        res.render('search-results', {
            pageTitle: `Результати пошуку для "${query}"`,
            query: query,
            products: products,
            posts: posts,
            csrfToken: req.csrfToken()
        });

    } catch (error) {
        next(error);
    }
});

app.get('/checkout', csrfProtection, (req, res) => {
    const cart = req.session.cart || [];
    let subtotal = 0;
    const cartItemsForRender = cart.map(item => {
        const price = parseFloat(item.price);
        const quantity = parseInt(item.quantity);
        const validPrice = (typeof price === 'number' && isFinite(price) && price >= 0) ? price : 0;
        const validQuantity = (typeof quantity === 'number' && isFinite(quantity) && quantity >= 0) ? quantity : 0;
        const lineTotal = validPrice * validQuantity;
        subtotal += lineTotal;
        return { ...item, price: validPrice, quantity: validQuantity, lineTotal: lineTotal };
    }).filter(item => item && item.productId);

    const total = subtotal;

    res.render('checkout', {
        pageTitle: 'Оформлення Замовлення - Вузлик',
        cartItems: cartItemsForRender,
        subtotal: subtotal,
        total: total,
        currentUser: req.user,
        csrfToken: req.csrfToken()
    });
});

app.get('/sitemap.xml', async (req, res) => {
  res.header('Content-Type', 'application/xml');
  res.header('Content-Encoding', 'gzip'); 

  const baseUrl = process.env.BASE_URL || 'https://vuzlyk.com';
  const sitemapStream = new SitemapStream({ hostname: baseUrl });
  const pipeline = sitemapStream.pipe(require('zlib').createGzip()); 

  try {
    const staticLinks = [
      { url: '/', changefreq: 'daily', priority: 1.0 },
      { url: '/catalog', changefreq: 'daily', priority: 0.9 },
      { url: '/blog', changefreq: 'weekly', priority: 0.8 },
      { url: '/about', changefreq: 'monthly', priority: 0.7 },
      { url: '/faq', changefreq: 'monthly', priority: 0.6 },
      { url: '/contacts', changefreq: 'monthly', priority: 0.6 },
      { url: '/terms', changefreq: 'yearly', priority: 0.3 },
      { url: '/privacy-policy', changefreq: 'yearly', priority: 0.3 },
    ];
    staticLinks.forEach(link => sitemapStream.write(link));

    const products = await Product.find({}).select('slug _id updatedAt').lean();
    products.forEach(product => {
      sitemapStream.write({
        url: `/product/${product.slug || product._id}`,
        changefreq: 'weekly',
        priority: 0.8,
        lastmod: product.updatedAt, 
      });
    });

    const posts = await Post.find({ isPublished: true }).select('slug updatedAt').lean();
    posts.forEach(post => {
      sitemapStream.write({
        url: `/blog/${post.slug}`,
        changefreq: 'monthly',
        priority: 0.7,
        lastmod: post.updatedAt,
      });
    });

    sitemapStream.end();

    pipeline.pipe(res).on('error', (e) => { throw e; });

  } catch (error) {
    res.status(500).end();
  }
});

app.post('/order/place', async (req, res) => {
    const cart = req.session.cart || [];
    if (!cart || cart.length === 0) {
        return res.redirect('/cart');
    }
    const {
        email, phone, full_name,
        shippingMethod, shipping_city, shipping_np_warehouse, shipping_address1,
        custom_description, comments,
        saveInfo
    } = req.body;
    if (!email || !phone || !full_name || !shippingMethod) {
        return res.redirect('/checkout?error=' + encodeURIComponent('Будь ласка, заповніть всі обов\'язкові поля.'));
    }
    const orderData = {
        contactInfo: { email, phone, name: full_name },
        shipping: {
            method: shippingMethod,
            city: shipping_city || null,
            warehouse: shipping_np_warehouse || null,
            address: shipping_address1 || null,
        },
        items: cart.map(item => ({
            name: item.name, productId: item.productId,
            quantity: item.quantity, price: item.price
        })),
        customDescription: custom_description || 'Не вказано',
        comments: comments || 'Немає',
        receivedAt: new Date(),
        status: 'Новий'
    };
    orderData.totalAmount = orderData.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    if (req.isAuthenticated() && req.user) {
        orderData.userId = req.user._id;
        if (saveInfo === 'on') {
            const contactToSave = {
                name: orderData.contactInfo.name,
                phone: orderData.contactInfo.phone
            };
            const shippingToSave = {
                method: orderData.shipping.method,
                city: orderData.shipping.city,
                warehouse: orderData.shipping.warehouse,
                address: orderData.shipping.address
            };
            try {
                await User.findByIdAndUpdate(req.user._id, {
                    $set: {
                        defaultContactInfo: contactToSave,
                        defaultShippingInfo: shippingToSave
                    }
                });
            } catch (updateError) {}
        }
    }
    try {
        const newOrder = new Order(orderData);
        await newOrder.save();

         sendTelegramOrderNotification(newOrder).catch(err => {
            console.error('[Telegram] Помилка при відправці сповіщення:', err.message);
        });
        
        const shortOrderId = newOrder._id.toString().slice(-6).toUpperCase();

        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || !process.env.ADMIN_EMAIL) {
            console.warn('Email configuration missing. Notifications not sent.');
        } else {
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: parseInt(process.env.SMTP_PORT, 10),
                secure: process.env.SMTP_SECURE === 'true', 
                auth: {
                    user: process.env.EMAIL_USER, 
                    pass: process.env.EMAIL_PASS,
                },
            });

            const emailHtmlAdmin = `
                <!DOCTYPE html>
                <html lang="uk">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                </head>
                <body style="margin: 0; padding: 0; background-color: #F4F2EE; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #F4F2EE; padding: 40px 15px;">
                        <tr><td align="center">
                            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.04);">
                                <tr><td align="center" style="padding: 30px 20px; border-bottom: 1px solid #EAE6DF; background-color: #ffffff;">
                                    <h1 style="margin: 0; color: #111111; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">
                                        <img src="https://vuzlyk.com/images/logo.png" alt="Лого" width="40" height="40" style="vertical-align: middle; margin-right: 12px; border-radius: 8px;">
                                        <span style="vertical-align: middle;">Вузлик до вузлика</span>
                                    </h1>
                                </td></tr>
                                <tr><td style="padding: 40px 30px; background-color: #ffffff;">
                                    <div style="text-align: center; margin-bottom: 30px;">
                                        <h2 style="margin: 0 0 10px 0; color: #b9936c; font-size: 22px; text-transform: uppercase; letter-spacing: 1px;">Нове замовлення</h2>
                                        <span style="display: inline-block; background-color: #fdfaf6; padding: 5px 15px; border-radius: 100px; border: 1px solid #e1c8a0; font-weight: bold; color: #a07e5a;">#${shortOrderId}</span>
                                    </div>
                                    <div style="background-color: #fdfaf6; border-radius: 12px; padding: 25px; margin-bottom: 25px; border-left: 4px solid #b9936c;">
                                        <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #111111; text-transform: uppercase; letter-spacing: 0.5px;">👤 Клієнт</h3>
                                        <p style="margin: 0 0 8px 0; font-size: 15px; color: #444;"><strong>Ім'я:</strong> ${orderData.contactInfo.name}</p>
                                        <p style="margin: 0 0 8px 0; font-size: 15px; color: #444;"><strong>Телефон:</strong> <a href="tel:${orderData.contactInfo.phone}" style="color: #b9936c; text-decoration: none;">${orderData.contactInfo.phone}</a></p>
                                        <p style="margin: 0 0 20px 0; font-size: 15px; color: #444;"><strong>Email:</strong> <a href="mailto:${orderData.contactInfo.email}" style="color: #b9936c; text-decoration: none;">${orderData.contactInfo.email}</a></p>
                                        <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #111111; text-transform: uppercase; letter-spacing: 0.5px; border-top: 1px dashed #e1c8a0; padding-top: 15px;">🚚 Доставка</h3>
                                        <p style="margin: 0 0 8px 0; font-size: 15px; color: #444;"><strong>Спосіб:</strong> ${orderData.shipping.method || 'не вказано'}</p>
                                        ${orderData.shipping.city ? `<p style="margin: 0 0 8px 0; font-size: 15px; color: #444;"><strong>Місто:</strong> ${orderData.shipping.city}</p>` : ''}
                                        ${orderData.shipping.warehouse ? `<p style="margin: 0 0 8px 0; font-size: 15px; color: #444;"><strong>Відділення:</strong> ${orderData.shipping.warehouse}</p>` : ''}
                                        ${orderData.shipping.address ? `<p style="margin: 0 0 8px 0; font-size: 15px; color: #444;"><strong>Адреса:</strong> ${orderData.shipping.address}</p>` : ''}
                                    </div>
                                    <h3 style="margin: 0 0 15px 0; font-size: 18px; color: #111111; border-bottom: 1px solid #EAE6DF; padding-bottom: 10px;">Товари</h3>
                                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 30px;">
                                        ${orderData.items.map(item => `
                                            <tr>
                                                <td style="padding: 12px 0; border-bottom: 1px solid #f0f0f0; color: #333; font-size: 15px; line-height: 1.4;">
                                                    <strong>${item.name}</strong><br>
                                                    <span style="color: #888; font-size: 13px;">Кількість: ${item.quantity} шт. | ID: ${item.productId || 'N/A'}</span>
                                                </td>
                                                <td align="right" style="padding: 12px 0; border-bottom: 1px solid #f0f0f0; color: #111; font-weight: bold; font-size: 15px;">
                                                    ${item.price * item.quantity} ₴
                                                </td>
                                            </tr>
                                        `).join('')}
                                        <tr>
                                            <td style="padding: 20px 0 0 0; font-size: 18px; font-weight: 800; color: #111111;">Сума до сплати:</td>
                                            <td align="right" style="padding: 20px 0 0 0; font-size: 20px; font-weight: 800; color: #b9936c;">${orderData.totalAmount} ₴</td>
                                        </tr>
                                    </table>
                                    ${orderData.customDescription !== 'Не вказано' ? `
                                        <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 15px; border-left: 3px solid #b9936c;">
                                            <strong style="display: block; margin-bottom: 8px; color: #111; font-size: 14px; text-transform: uppercase;">Опис "Своя вишивка"</strong>
                                            <div style="color: #555; font-size: 15px; line-height: 1.5; white-space: pre-wrap;">${orderData.customDescription}</div>
                                        </div>
                                    ` : ''}
                                    ${orderData.comments !== 'Немає' ? `
                                        <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin-bottom: 15px; border-left: 3px solid #64748b;">
                                            <strong style="display: block; margin-bottom: 8px; color: #111; font-size: 14px; text-transform: uppercase;">Коментар клієнта</strong>
                                            <div style="color: #555; font-size: 15px; line-height: 1.5; white-space: pre-wrap;">${orderData.comments}</div>
                                        </div>
                                    ` : ''}
                                    <p style="margin: 20px 0 0 0; color: #888; font-size: 13px; text-align: center;">Отримано: ${orderData.receivedAt.toLocaleString('uk-UA', { dateStyle: 'long', timeStyle: 'short' })}</p>
                                </td></tr>
                                <tr><td align="center" style="padding: 25px; background-color: #faf9f7; border-top: 1px solid #EAE6DF;">
                                    <p style="margin: 0; color: #aaaaaa; font-size: 12px;">Системне сповіщення про замовлення з сайту Vuzlyk.</p>
                                </td></tr>
                            </table>
                        </td></tr>
                    </table>
                </body>
                </html>
            `;

            const mailOptionsAdmin = {
                from: `"Сайт Vuzlyk" <info@vuzlyk.com>`,
                to: process.env.ADMIN_EMAIL,
                subject: `Нове замовлення #${shortOrderId} від ${orderData.contactInfo.name}`,
                html: emailHtmlAdmin
            };
            
            transporter.sendMail(mailOptionsAdmin, (error, info) => {});

            const customerSubject = `Ваш запит на замовлення #${shortOrderId} успішно отримано!`;
            
            const customerEmailHtml = `
                <!DOCTYPE html>
                <html lang="uk">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                </head>
                <body style="margin: 0; padding: 0; background-color: #F4F2EE; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #F4F2EE; padding: 40px 15px;">
                        <tr><td align="center">
                            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.04);">
                                <tr><td align="center" style="padding: 30px 20px; border-bottom: 1px solid #EAE6DF; background-color: #ffffff;">
                                    <h1 style="margin: 0; color: #111111; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">
                                        <img src="https://vuzlyk.com/images/logo.png" alt="Лого" width="40" height="40" style="vertical-align: middle; margin-right: 12px; border-radius: 8px;">
                                        <span style="vertical-align: middle;">Вузлик до вузлика</span>
                                    </h1>
                                </td></tr>
                                <tr><td style="padding: 40px 30px; background-color: #ffffff;">
                                    <h2 style="margin: 0 0 20px 0; color: #111111; font-size: 22px; font-weight: 600; text-align: center;">Дякуємо за ваше замовлення!</h2>
                                    <p style="margin: 0 0 30px 0; color: #666666; font-size: 16px; line-height: 1.6; text-align: center;">
                                        Вітаємо, <strong>${orderData.contactInfo.name}</strong>! Ми отримали ваш запит <strong style="color: #b9936c;">#${shortOrderId}</strong> і вже почали його обробляти.
                                    </p>
                                    <div style="background-color: #fdfaf6; border: 1px solid #e1c8a0; border-radius: 12px; padding: 25px; margin-bottom: 35px;">
                                        <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #111111; border-bottom: 1px dashed #e1c8a0; padding-bottom: 10px; text-transform: uppercase;">Деталі замовлення</h3>
                                        <table width="100%" cellpadding="0" cellspacing="0">
                                            ${orderData.items.map(item => `
                                                <tr>
                                                    <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #333; font-size: 15px; font-weight: 500;">
                                                        ${item.name}
                                                    </td>
                                                    <td align="right" style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #888; font-size: 14px;">
                                                        ${item.quantity} шт.
                                                    </td>
                                                </tr>
                                            `).join('')}
                                        </table>
                                        ${orderData.customDescription !== 'Не вказано' ? `
                                            <div style="margin-top: 20px; background: rgba(255,255,255,0.7); padding: 15px; border-radius: 8px;">
                                                <strong style="display: block; color: #b9936c; font-size: 14px; margin-bottom: 5px;">Ваш опис "Своя вишивка":</strong>
                                                <div style="color: #555; font-size: 14px; font-style: italic; white-space: pre-wrap; line-height: 1.5;">${orderData.customDescription}</div>
                                            </div>
                                        ` : ''}
                                    </div>
                                    <h3 style="margin: 0 0 15px 0; color: #111111; font-size: 18px;">Що далі?</h3>
                                    <p style="margin: 0 0 15px 0; color: #666666; font-size: 15px; line-height: 1.6;">
                                        Ми зв'яжемося з вами найближчим робочим часом за вказаним номером (<strong>${orderData.contactInfo.phone}</strong>) або електронною поштою.
                                    </p>
                                    <p style="margin: 0; color: #666666; font-size: 15px; line-height: 1.6;">
                                        Під час розмови ми уточнимо всі деталі замовлення, узгодимо остаточну вартість (якщо є індивідуальні побажання) та терміни виконання. Очікуйте на наше повідомлення!
                                    </p>
                                </td></tr>
                                <tr><td align="center" style="padding: 30px; background-color: #faf9f7; border-top: 1px solid #EAE6DF;">
                                    <p style="margin: 0 0 10px 0; color: #666666; font-size: 15px;">
                                        З теплом та натхненням,<br>
                                        <strong style="color: #111111;">Майстерня «Вузлик до вузлика»</strong>
                                    </p>
                                </td></tr>
                            </table>
                        </td></tr>
                    </table>
                </body>
                </html>
            `;

            const mailOptionsCustomer = {
                from: `"Вузлик до вузлика" <info@vuzlyk.com>`,
                to: orderData.contactInfo.email,
                subject: customerSubject,
                html: customerEmailHtml
            };
            
            transporter.sendMail(mailOptionsCustomer, (error, info) => {});
        }

        req.session.cart = [];
        
        req.session.lastOrder = {
            orderId: shortOrderId,
            email: orderData.contactInfo.email
        };

        res.redirect('/order/request-sent');

    } catch (error) {
        res.redirect('/checkout?error=' + encodeURIComponent('Помилка при оформленні замовлення. Спробуйте пізніше.'));
    }
});

app.get('/order/request-sent', csrfProtection, (req, res) => {
    const orderData = req.session.lastOrder || {};
    
    if (req.session.lastOrder) {
        delete req.session.lastOrder;
    }

    res.render('order-request-sent', {
        pageTitle: 'Замовлення відправлено - Вузлик до вузлика',
        orderId: orderData.orderId || '', 
        customerEmail: orderData.email || '',
        csrfToken: req.csrfToken()
    });
});

app.get('/about', csrfProtection, (req, res) => {
    res.render('about', {
        pageTitle: 'Про нас - Вузлик до вузлика',
        metaDescription: 'Дізнайтеся більше про майстерню ручної вишивки «Вузлик до вузлика» — наша історія, цінності та любов до кожного стібка.',
        csrfToken: req.csrfToken()
    });
});

app.get('/faq', csrfProtection, (req, res) => {
    res.render('faq', {
        pageTitle: 'Часті питання - Вузлик до вузлика',
        metaDescription: 'Відповіді на найпоширеніші питання про замовлення, доставку, оплату та догляд за виробами майстерні «Вузлик до вузлика».',
        csrfToken: req.csrfToken()
    });
});

app.get('/terms', csrfProtection, (req, res) => {
    res.render('terms-of-service', {
        pageTitle: 'Умови використання - Вузлик до вузлика',
        metaDescription: 'Правила та умови використання сайту майстерні ручної вишивки «Вузлик до вузлика».',
        csrfToken: req.csrfToken()
    });
});

app.get('/privacy-policy', csrfProtection, (req, res) => {
    res.render('privacy-policy', {
        pageTitle: 'Політика конфіденційності - Вузлик до вузлика',
        metaDescription: 'Інформація про те, як ми збираємо, використовуємо та захищаємо ваші персональні дані.',
        csrfToken: req.csrfToken()
    });
});

app.get('/contacts', csrfProtection, (req, res) => {
    res.render('contacts', {
        pageTitle: "Контакти - Вузлик до вузлика", 
        query: req.query,
        formData: {},
        csrfToken: req.csrfToken()
    });
});

app.get('/feeds/local-inventory.txt', async (req, res) => {
    try {
        let feedContent = cache.get('local_inventory_feed');
        
        if (!feedContent) {
            const products = await Product.find({}).select('_id').lean(); 
            const storeCode = 'VUZLYK_BROVARY'; 
            feedContent = 'store_code\tid\tavailability\n';

            products.forEach(product => {
                feedContent += `${storeCode}\t${product._id}\tin_stock\n`;
            });
            
            cache.set('local_inventory_feed', feedContent, 3600);
        }

        res.header('Content-Type', 'text/plain');
        res.send(feedContent);
    } catch (error) {
        res.status(500).send('Помилка сервера при генерації фіда');
    }
});

app.get('/feeds/google-shopping.xml', async (req, res) => {
    try {
        const cacheKey = 'google_shopping_primary_feed';
        let feedContent = cache.get(cacheKey); 
        
        if (!feedContent) {
            const products = await Product.find({}).lean();
            const baseUrl = process.env.BASE_URL || 'https://vuzlyk.com';
            
            let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
<channel>
    <title>Вузлик до вузлика - Каталог товарів</title>
    <link>${baseUrl}</link>
    <description>Ексклюзивна ручна вишивка від майстерні "Вузлик до вузлика"</description>`;

            products.forEach(product => {
                if (!product.name || !product.price) return;

                let imageUrl = '';
                if (product.images && product.images.length > 0 && product.images[0].large) {
                    imageUrl = product.images[0].large.url;
                    if (!imageUrl.startsWith('http')) {
                        imageUrl = new URL(imageUrl, baseUrl).href;
                    }
                } else {
                    imageUrl = `${baseUrl}/images/placeholder.svg`;
                }

                const productLink = `${baseUrl}/product/${product.slug || product._id}`;
                const description = (product.description || product.name)
                                    .replace(/<[^>]*>?/gm, '')
                                    .replace(/&/g, '&amp;') 
                                    .replace(/</g, '&lt;')
                                    .replace(/>/g, '&gt;');
                
                const title = product.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                
                const productType = product.category ? `<g:product_type><![CDATA[${product.category}]]></g:product_type>` : '';
                
                let availability = 'in_stock';
                if (product.status === 'Продано') availability = 'out_of_stock';
                if (product.status === 'Під замовлення') availability = 'preorder';

                xml += `
    <item>
        <g:id>${product._id}</g:id>
        <g:title>${title}</g:title>
        <g:description>${description}</g:description>
        <g:link>${productLink}</g:link>
        <g:image_link>${imageUrl}</g:image_link>
        <g:condition>new</g:condition>
        <g:availability>${availability}</g:availability>
        <g:price>${product.price}.00 UAH</g:price>
        <g:brand>Вузлик до вузлика</g:brand>
        ${productType}
    </item>`;
            });

            xml += `
</channel>
</rss>`;

            feedContent = xml;
            cache.set(cacheKey, feedContent, 3600); 
        }

        res.header('Content-Type', 'application/xml');
        res.send(feedContent);
    } catch (error) {
        console.error("Помилка генерації Основного фіда Google:", error);
        res.status(500).send('Помилка сервера при генерації фіда');
    }
});

app.post('/contacts/send', csrfProtection, async (req, res) => {
    const { name, email, phone, subject, message } = req.body;
    const recaptchaToken = req.body['g-recaptcha-response'];

    if (!name || !email || !message) {
        return res.render('contacts', {
            pageTitle: "Помилка відправки - Контакти",
            query: { error: 'Будь ласка, заповніть усі обов\'язкові поля.' },
            formData: { name, email, phone, subject, message },
            csrfToken: req.csrfToken() 
        });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.render('contacts', {
            pageTitle: "Помилка відправки - Контакти",
            query: { error: 'Будь ласка, введіть коректний email.' },
            formData: { name, email, phone, subject, message },
            csrfToken: req.csrfToken() 
        });
    }

if (!process.env.RECAPTCHA_V2_SECRET_KEY) {
        return res.render('contacts', {
            pageTitle: "Помилка відправки - Контакти",
            query: { error: 'Помилка конфігурації сервера reCAPTCHA.' },
            formData: { name, email, phone, subject, message },
            csrfToken: req.csrfToken() 
        });
    }

    if (!recaptchaToken) {
        return res.render('contacts', {
            pageTitle: "Помилка відправки - Контакти",
            query: { error: 'Будь ласка, пройдіть перевірку "Я не робот".' },
            formData: { name, email, phone, subject, message },
            csrfToken: req.csrfToken() 
        });
    }
    
    try {
        const secretKey = process.env.RECAPTCHA_V2_SECRET_KEY;
        const verificationURL = `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${recaptchaToken}&remoteip=${req.ip}`;
        const recaptchaResponse = await axios.post(verificationURL);
        const recaptchaData = recaptchaResponse.data;

        if (!recaptchaData.success) {
            return res.render('contacts', {
                pageTitle: "Помилка відправки - Контакти",
                query: { error: 'Перевірка "Я не робот" не пройдена. Спробуйте ще раз.' },
                formData: { name, email, phone, subject, message },
                csrfToken: req.csrfToken()
            });
        }

        const mailSubject = subject ? `Повідомлення з сайту Вузлик: ${subject}` : `Нове повідомлення з контактної форми Вузлик від ${name}`;
        const mailText = `Ім'я: ${name}\nEmail: ${email}\nТелефон: ${phone || 'Не вказано'}\nТема: ${subject || 'Без теми'}\n\nПовідомлення:\n${message}`;
        const mailHtml = `<p><strong>Ім'я:</strong> ${name}</p><p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p><p><strong>Телефон:</strong> ${phone || 'Не вказано'}</p><p><strong>Тема:</strong> ${subject || 'Без теми'}</p><hr><p><strong>Повідомлення:</strong></p><p style="white-space: pre-wrap;">${message}</p>`;

        if (!process.env.SMTP_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS || !process.env.ADMIN_EMAIL) {
            return res.redirect('/contacts?error=' + encodeURIComponent('Помилка сервера. Не вдалося відправити повідомлення.'));
        }
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT, 10),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });
        await transporter.sendMail({
            from: `"${name} (Сайт Вузлик)" <${process.env.EMAIL_USER}>`,
            replyTo: email,
            to: process.env.ADMIN_EMAIL,
            subject: mailSubject,
            text: mailText,
            html: mailHtml,
        });

        res.redirect('/contacts?success=true');

    } catch (error) {
        return res.render('contacts', {
            pageTitle: "Помилка відправки - Контакти",
            query: { error: 'Сталася помилка при відправці повідомлення. Спробуйте пізніше.' },
            formData: { name, email, phone, subject, message },
            csrfToken: req.csrfToken()
        });
    }
});

app.use((req, res, next) => {
  res.status(404).render('404', { pageTitle: 'Сторінку Не Знайдено' });
});

app.use((err, req, res, next) => {
    const localsForError = {
        ...res.locals,
        currentUser: req.user || null, 
        isAdmin: (req.session && req.session.isAdmin) || false,
        cartItemCount: (req.session && req.session.cart) ? req.session.cart.reduce((sum, item) => sum + (item.quantity || 0), 0) : 0,
        selectedCurrency: (req.session && req.session.currency) || 'UAH',
        exchangeRates: currentRates,
        currencySymbols: CURRENCY_SYMBOLS,
        formatPrice: app.locals.formatPrice,
        baseUrl: process.env.BASE_URL || `${req.protocol}://${req.get('host')}`
    };

    if (err.code === 'EBADCSRFTOKEN') {
      return res.status(403).render('error', { 
          ...localsForError,
          pageTitle: 'Помилка безпеки',
          message: 'Форма застаріла або недійсна. Будь ласка, поверніться назад, оновіть сторінку та спробуйте ще раз.'
      });
    }

    const statusCode = err.status || 500;
    const userMessage = (statusCode >= 500 && process.env.NODE_ENV === 'production') 
        ? 'На жаль, на сервері сталася несподівана помилка.'
        : (err.message || 'Сталася помилка.');
    
    if (statusCode === 404) {
        return res.status(404).render('404', {
            ...localsForError,
            pageTitle: 'Сторінку Не Знайдено'
        });
    }

    res.status(statusCode).render('500', { 
        ...localsForError,
        pageTitle: 'Помилка сервера', 
        message: userMessage 
    });
});

app.locals.formatPrice = (amountUAH, targetCurrency, rates, symbols) => {
    const baseAmount = typeof amountUAH === 'number' ? amountUAH : 0;
    const currency = (targetCurrency && rates?.[targetCurrency]) ? targetCurrency : 'UAH';
    const rate = rates?.[currency] ?? 1;
    const symbol = symbols?.[currency] ?? '₴'; 

    const convertedAmount = baseAmount * rate;
    const formattedAmount = convertedAmount.toFixed(2);

    return currency === 'UAH' ? `${formattedAmount} ${symbol}` : `${symbol}${formattedAmount}`;
};

app.listen(PORT, () => {
  console.log(`Сервер запущено на порту ${PORT}`);
});