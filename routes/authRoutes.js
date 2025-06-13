const express = require('express');
const passport = require('passport');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const User = require('../models/User');
const Order = require('../models/Order');
const Review = require('../models/Review');
const Verification = require('../models/Verification');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const router = express.Router();

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 10, 
    message: { message: 'Забагато спроб входу з цієї IP-адреси, будь ласка, спробуйте знову через 15 хвилин.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, res) => req.ip + (req.body.email ? req.body.email.toLowerCase() : ''),
    handler: (req, res, next, options) => {
        console.warn(`Rate limit exceeded for LOGIN by IP ${req.ip} on ${req.originalUrl}`);
        res.redirect('/login?error=' + encodeURIComponent(options.message.message));
    }
});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, 
    max: 5, 
    message: { message: 'Забагато спроб реєстрації з цієї IP-адреси, будь ласка, спробуйте пізніше.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, res) => req.ip, 
    handler: (req, res, next, options) => {
        console.warn(`Rate limit exceeded for REGISTER by IP ${req.ip} on ${req.originalUrl}`);
        res.render('register', {
            pageTitle: 'Помилка Реєстрації',
            errors: [{ msg: options.message.message }], 
            name: req.body.name || '',
            email: req.body.email || '',
            query: req.query
        });
    }
});

const verifyCodeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 7, 
    message: { message: 'Забагато спроб введення коду верифікації, спробуйте пізніше.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, res) => req.ip + (req.session.verificationEmail || ''), 
    handler: (req, res, next, options) => {
        console.warn(`Rate limit exceeded for VERIFY CODE by IP ${req.ip} on ${req.originalUrl}`);
        res.redirect('/verify-email?error=' + encodeURIComponent(options.message.message));
    }
});

const passwordChangeLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: { message: 'Забагато спроб зміни пароля, будь ласка, спробуйте пізніше.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, res) => req.ip + (req.user ? req.user._id : ''), 
     handler: (req, res, next, options) => {
        console.warn(`Rate limit exceeded for PASSWORD CHANGE by IP ${req.ip} (User: ${req.user?._id}) on ${req.originalUrl}`);
        res.redirect('/profile?error=' + encodeURIComponent(options.message.message));
    }
});

const resendVerificationLimiter = rateLimit({
    windowMs: 30 * 60 * 1000, 
    max: 3, 
    message: { message: 'Забагато спроб повторної відправки коду. Будь ласка, спробуйте пізніше.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.query.email ? req.query.email.toLowerCase() : req.ip, 
    handler: (req, res, next, options) => {
        console.warn(`Rate limit exceeded for RESEND VERIFICATION by email/IP ${req.query.email || req.ip} on ${req.originalUrl}`);
        res.redirect(`/verify-email?error=${encodeURIComponent(options.message.message)}`);
    }
});


async function sendVerificationEmail(email, code) {
    if (!process.env.SMTP_HOST || !process.env.SMTP_PORT || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.error('ПОМИЛКА: Email credentials або SMTP налаштування не встановлені в .env');
        throw new Error('Налаштування для відправки email відсутні.');
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

    const mailOptions = {
        from: `"Вузлик до вузлика" <${process.env.EMAIL_USER}>`, 
        to: email,
        subject: 'Код підтвердження реєстрації на сайті Вузлик',
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                <h2>Вітаємо у Вузлик до вузлика!</h2>
                <p>Для завершення реєстрації, будь ласка, використайте наступний код підтвердження:</p>
                <p style="font-size: 24px; font-weight: bold; color: #b9936c; letter-spacing: 2px; margin: 20px 0;">${code}</p>
                <p>Цей код дійсний протягом 15 хвилин.</p>
                <p>Якщо ви не намагалися зареєструватися, просто проігноруйте цей лист.</p>
                <hr>
                <p style="font-size: 0.9em; color: #777;">З повагою,<br>Майстерня Вузлик до вузлика</p>
                <p style="font-size:0.8em; color:#aaa;">Це повідомлення надіслано з адреси ${process.env.EMAIL_USER}</p>
            </div>
        `,
        text: `Вітаємо у Вузлик! Ваш код підтвердження: ${code}. Цей код дійсний протягом 15 хвилин. Якщо ви не реєструвалися, проігноруйте цей лист. Надіслано з ${process.env.EMAIL_USER}`
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`[Email Service] Код підтвердження відправлено на ${email} з адреси ${process.env.EMAIL_USER}`);
    } catch (error) {
        console.error(`[Email Service] Помилка відправки коду на ${email} з ${process.env.EMAIL_USER}:`, error);
    }
}

function isLoggedIn(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    console.log('Доступ запрещен! Користувач не аутентифікований. Перенаправлення на /login.');
    res.redirect('/login');
}

router.get('/register', (req, res) => {
    res.render('register', {
        pageTitle: 'Реєстрація',
        errors: req.query.error ? [{ msg: decodeURIComponent(req.query.error) }] : [],
        name: req.query.name || '',
        email: req.query.email || '',
        query: req.query
    });
});

router.post('/register', registerLimiter,
    [
      body('email', 'Будь ласка, введіть дійсний email').isEmail().normalizeEmail(),
      body('name', 'Ім\'я не може бути порожнім').notEmpty().trim().escape(), 
      body('password', 'Пароль повинен містити мінімум 5 символів').isLength({ min: 5 }),
       body('password').custom((value, { req }) => {
           if (!/[A-Z]/.test(value)) {
               throw new Error('Пароль повинен містити принаймні одну велику літеру.');
           }
           if (!/[0-9]/.test(value)) {
               throw new Error('Пароль повинен містити принаймні одну цифру.');
           }
           return true;
       }),
      body('confirmPassword').custom((value, { req }) => {
        if (value !== req.body.password) {
          throw new Error('Паролі не співпадають');
        }
        return true;
      }),
    ],
    async (req, res, next) => {
const errors = validationResult(req);
if (!errors.isEmpty()) {
  return res.render('register', {
    pageTitle: 'Помилка Реєстрації',
    errors: errors.array().map(err => ({ msg: err.msg })),
    name: req.body.name || '',
    email: req.body.email || '',
    query: req.query
  });
}
      const { email, password, name } = req.body;

      try {
          const lowerCaseEmail = email.toLowerCase();
const existingUser = await User.findOne({ email: lowerCaseEmail });
if (existingUser) {
    const validationErrors = [{ msg: 'Цей email вже зареєстровано. <a href="/login">Увійти?</a>' }];
    return res.render('register', {
        pageTitle: 'Помилка Реєстрації',
        errors: validationErrors, 
        name: name,           
        email: email,        
        query: req.query
    });
}
  
          await Verification.deleteMany({ email: lowerCaseEmail }); 
  
          const salt = await bcrypt.genSalt(10);
          const hashedPassword = await bcrypt.hash(password, salt); 
  
          const verificationCode = crypto.randomInt(100000, 999999).toString(); 
          const expiresAt = new Date(Date.now() + 15 * 60 * 1000); 
  
          const newVerification = new Verification({
              email: lowerCaseEmail,
              name, 
              hashedPassword,
              verificationCode,
              expiresAt
          });
          await newVerification.save(); 
          console.log(`Створено запит на верифікацію для ${lowerCaseEmail}`);
  
          await sendVerificationEmail(lowerCaseEmail, verificationCode); 
  
          req.session.verificationEmail = lowerCaseEmail; 
          res.redirect('/verify-email'); 
  
      } catch (error) {
          console.error('Помилка під час реєстрації (крок 1):', error);
          const catchErrors = [];
          if (error.code === 11000) {
               catchErrors.push({ msg: 'Помилка збереження даних верифікації. Можливо, спробуйте ще раз.' });
          } else if (error.message.includes('відправки email')) {
               catchErrors.push({ msg: error.message });
          } else {
               catchErrors.push({ msg: 'Виникла серверна помилка. Спробуйте пізніше.' });
          }
          res.render('register', {
              pageTitle: 'Помилка Реєстрації',
              errors: catchErrors, 
              name: name,     
              email: email,    
              query: req.query
          });
      }
  });

router.get('/verify-email', (req, res) => {
    const email = req.session.verificationEmail;
    if (!email) {
        return res.redirect('/register');
    }
    res.render('verify-email', {
        pageTitle: 'Підтвердження Email',
        email: email,
        error: req.query.error ? decodeURIComponent(req.query.error) : null,
        success: req.query.success ? decodeURIComponent(req.query.success) : null 
    });
});

router.get('/resend-verification', resendVerificationLimiter, async (req, res) => {
    const email = req.query.email ? req.query.email.toLowerCase() : null;

    if (!email) {
        return res.redirect('/register?error=' + encodeURIComponent('Email не вказано для повторної відправки коду.'));
    }

    if (req.session.verificationEmail && req.session.verificationEmail !== email) {
        console.warn(`Attempt to resend code for ${email} but session has ${req.session.verificationEmail}`);
        return res.redirect(`/verify-email?error=${encodeURIComponent('Помилка: email не співпадає з активною сесією верифікації.')}`);
    }
    
    try {
        const verificationData = await Verification.findOne({ email: email });

        if (!verificationData) {
            return res.redirect('/register?error=' + encodeURIComponent('Активний запит на верифікацію для цього email не знайдено. Будь ласка, зареєструйтеся знову.') + `&email=${encodeURIComponent(email)}`);
        }
        
        const newVerificationCode = crypto.randomInt(100000, 999999).toString();
        const newExpiresAt = new Date(Date.now() + 15 * 60 * 1000); 

        verificationData.verificationCode = newVerificationCode;
        verificationData.expiresAt = newExpiresAt;
        verificationData.createdAt = new Date(); 
        await verificationData.save();

        await sendVerificationEmail(email, newVerificationCode);

        req.session.verificationEmail = email; 
        
        console.log(`Новий код верифікації відправлено на ${email}`);
        res.redirect('/verify-email?success=' + encodeURIComponent('Новий код підтвердження було відправлено на вашу пошту.'));

    } catch (error) {
        console.error(`Помилка повторної відправки коду для ${email}:`, error);
        let userErrorMessage = 'Не вдалося повторно відправити код. Спробуйте пізніше.';
        if (error.message.includes('Налаштування для відправки email відсутні')) {
            userErrorMessage = 'Сервіс відправки email тимчасово недоступний.';
        }
        res.redirect(`/verify-email?error=${encodeURIComponent(userErrorMessage)}`);
    }
});


router.post('/verify-code', verifyCodeLimiter, async (req, res, next) => {
    const { code } = req.body;
    const email = req.session.verificationEmail;

    if (!code || !email) {
        return res.redirect('/verify-email?error=' + encodeURIComponent('Відсутній код або email сесії.'));
    }

    try {
        const verificationData = await Verification.findOne({ email: email }); 

        if (!verificationData) {
            return res.redirect('/verify-email?error=' + encodeURIComponent('Запис верифікації не знайдено. Спробуйте зареєструватися знову.'));
        }

        if (verificationData.expiresAt < new Date()) { 
            await Verification.deleteOne({ email: email }); 
            return res.redirect('/verify-email?error=' + encodeURIComponent('Термін дії коду минув. Спробуйте зареєструватися знову.'));
        }

        if (verificationData.verificationCode !== code) { 
            return res.redirect('/verify-email?error=' + encodeURIComponent('Неправильний код підтвердження.'));
        }

        console.log(`Верифікація для ${email} успішна.`);

        const newUser = new User({
            name: verificationData.name, 
            email: verificationData.email, 
            password: verificationData.hashedPassword 
        });
        await newUser.save(); 
        console.log(`Новий користувач ${newUser.email} створений.`);

        await Verification.deleteOne({ email: email }); 

        delete req.session.verificationEmail; 

        req.login(newUser, (err) => { 
            if (err) {
                console.error('Помилка автоматичного входу після верифікації:', err);
                return res.redirect('/login?message=' + encodeURIComponent('Акаунт створено! Будь ласка, увійдіть.'));
            }
            console.log(`Користувач ${newUser.email} автоматично залогінений після верифікації.`);
            const redirectUrl = req.session.returnTo || '/profile'; 
            delete req.session.returnTo; 
            res.redirect(redirectUrl); 
        });

    } catch (error) {
        console.error('Помилка під час перевірки коду:', error);
        if (error.code === 11000) {
            res.redirect('/login?message=' + encodeURIComponent('Цей email вже зареєстровано. Будь ласка, увійдіть.'));
        } else {
            res.redirect('/verify-email?error=' + encodeURIComponent('Серверна помилка при перевірці коду.'));
        }
    }
});

router.get('/login', (req, res) => {
    const loginError = req.query.error === '1' ? 'Неправильний email або пароль.' : null;
    if (req.query.redirect && !req.session.returnTo) {
        req.session.returnTo = req.query.redirect;
    }
    res.render('login', {
        pageTitle: 'Вхід',
        error: loginError,
        query: req.query,
        message: req.query.message ? decodeURIComponent(req.query.message) : null 
    });
});

router.post('/login', loginLimiter, passport.authenticate('local', {
    failureRedirect: '/login?error=1',
    failureMessage: false
}), (req, res) => {
    const redirectUrl = req.session.returnTo || '/';
    delete req.session.returnTo;
    console.log(`User ${req.user.email} logged in. Redirecting to ${redirectUrl}`);
    res.redirect(redirectUrl);
});

router.get('/profile', isLoggedIn, async (req, res, next) => {
    try {
        const userId = req.user._id;
        const [userOrders, userReviews] = await Promise.all([
            Order.find({ userId: userId }).sort({ createdAt: -1 }).lean(),
            Review.find({ userId: userId }).select('productId').lean()
        ]);
        const reviewedProductIds = new Set(userReviews.map(review => review.productId.toString()));

        res.render('profile', {
            pageTitle: 'Мій профіль',
            user: req.user,
            orders: userOrders,
            reviewedProductIds: reviewedProductIds,
            query: req.query,
            success: req.query.success ? decodeURIComponent(req.query.success) : null, 
            error: req.query.error ? decodeURIComponent(req.query.error) : null, 
        });
    } catch (error) {
        console.error("Помилка завантаження даних профілю:", error);
        next(error);
    }
});

router.put('/profile/update', isLoggedIn, async (req, res, next) => {
    const { name } = req.body;
    const userId = req.user._id;

    if (!name || name.trim().length === 0) {
        return res.redirect('/profile?error=' + encodeURIComponent('Ім\'я не може бути порожнім.'));
    }

    try {
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { name: name.trim() },
            { new: true, runValidators: true }
        );

        if (!updatedUser) {
            return res.redirect('/profile?error=' + encodeURIComponent('Не вдалося знайти користувача.'));
        }

        console.log(`User ${userId} updated name to: ${updatedUser.name}`);
        req.login(updatedUser, (err) => { 
            if (err) { return next(err); }
            res.redirect('/profile?success=' + encodeURIComponent('Ім\'я успішно оновлено!'));
        });

    } catch (error) {
        console.error(`Error updating profile for user ${userId}:`, error);
        let errorMsg = 'Помилка оновлення профілю.';
        if (error.name === 'ValidationError') {
            errorMsg = Object.values(error.errors).map(el => el.message).join(' ');
        }
        res.redirect('/profile?error=' + encodeURIComponent(errorMsg));
    }
});

router.post('/profile/change-password', passwordChangeLimiter, isLoggedIn, async (req, res, next) => {
    const { currentPassword, newPassword, confirmNewPassword } = req.body;
    const userId = req.user._id;

    if (req.user.googleId) { 
        return res.redirect('/profile?error=' + encodeURIComponent('Зміна пароля недоступна для Google акаунтів.'));
    }

    if (!currentPassword || !newPassword || !confirmNewPassword) {
        return res.redirect('/profile?error=' + encodeURIComponent('Будь ласка, заповніть усі поля для зміни пароля.'));
    }
    if (newPassword !== confirmNewPassword) {
        return res.redirect('/profile?error=' + encodeURIComponent('Нові паролі не співпадають.'));
    }
    if (newPassword.length < 5) {
        return res.redirect('/profile?error=' + encodeURIComponent('Новий пароль повинен містити принаймні 5 символів.'));
    }
     if (!/[A-Z]/.test(newPassword)) {
        return res.redirect('/profile?error=' + encodeURIComponent('Новий пароль повинен містити принаймні одну велику літеру.'));
    }
    if (!/[0-9]/.test(newPassword)) {
        return res.redirect('/profile?error=' + encodeURIComponent('Новий пароль повинен містити принаймні одну цифру.'));
    }

    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.redirect('/profile?error=' + encodeURIComponent('Не вдалося знайти користувача.'));
        }

        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) {
            return res.redirect('/profile?error=' + encodeURIComponent('Поточний пароль введено неправильно.'));
        }

        user.password = newPassword;
        await user.save();

        console.log(`User ${userId} successfully changed password.`);
        res.redirect('/profile?success=' + encodeURIComponent('Пароль успішно змінено!'));

    } catch (error) {
        console.error(`Error changing password for user ${userId}:`, error);
        let errorMsg = 'Помилка зміни пароля.';
        if (error.name === 'ValidationError') {
            errorMsg = Object.values(error.errors).map(el => el.message).join(' ');
        }
        res.redirect('/profile?error=' + encodeURIComponent(errorMsg));
    }
});


router.get('/logout', (req, res, next) => {
    req.logout((err) => {
      if (err) {
        console.error('Помилка при виході користувача:', err);
        return next(err); 
      }
      req.session.destroy(destroyErr => {
        if (destroyErr) {
          console.error("Помилка при знищенні сесії користувача:", destroyErr);
        }
        res.clearCookie('connect.sid'); 
        console.log('Користувач вийшов з системи. Сесію знищено.');
        res.redirect('/'); 
      });
    });
  });

router.get('/product/:id/review', isLoggedIn, async (req, res, next) => {
    const productId = req.params.id;
    const userId = req.user._id;

    try {
        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return res.status(404).render('404', { message: 'Неправильний ID товару.' });
        }
        const product = await Product.findById(productId).lean();
        if (!product) {
            return res.status(404).render('404', { message: 'Товар не знайдено.' });
        }

        const purchase = await Order.findOne({
            userId: userId,
            'items.productId': productId, 
            status: 'Виконано'
        }).select('_id').lean();

        if (!purchase) {
            console.log(`User ${userId} hasn't purchased product ${productId} or order not completed.`);
            return res.redirect(`/product/${productId}?error=not_purchased`);
        }

        const existingReview = await Review.findOne({
            productId: productId,
            userId: userId
        }).select('_id').lean();

        if (existingReview) {
            console.log(`User ${userId} already reviewed product ${productId}.`);
            return res.redirect(`/product/${productId}?error=already_reviewed`);
        }

        res.render('new-review', { 
            pageTitle: `Відгук на ${product.name}`,
            product: product,
            user: req.user,
            query: req.query
        });

    } catch (error) {
        console.error(`Error getting review page for product ${productId}:`, error);
        next(error);
    }
});

router.get('/auth/google', passport.authenticate('google', {
    scope: ['profile', 'email']
}));

router.get('/auth/google/callback', passport.authenticate('google', {
    failureRedirect: '/login',
}), (req, res) => {
    console.log('Google authentication successful, user:', req.user?.email);
    const redirectUrl = req.session.returnTo || '/'; 
    delete req.session.returnTo;
    res.redirect(redirectUrl);
});


module.exports = router;