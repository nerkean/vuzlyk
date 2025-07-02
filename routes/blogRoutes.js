const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Post = require('../models/Post'); 

const POSTS_PER_PAGE = 5; 

router.get('/', async (req, res, next) => {
    const page = parseInt(req.query.page) || 1;
    try {
        const skip = (page - 1) * POSTS_PER_PAGE;

        const postsQuery = Post.find({ isPublished: true })
            .sort({ publishedAt: -1 })
            .skip(skip)
            .limit(POSTS_PER_PAGE)
            .lean(); 

        const totalPublishedPostsQuery = Post.countDocuments({ isPublished: true });

        const [posts, totalPublishedPosts] = await Promise.all([
            postsQuery,
            totalPublishedPostsQuery
        ]);

        const totalPages = Math.ceil(totalPublishedPosts / POSTS_PER_PAGE);

        res.render('blog/blog-index', { 
            pageTitle: 'Блог майстерні "Вузлик до вузлика" - Статті про вишивку',
            metaDescription: 'Читайте цікаві статті про українську вишивку, традиції, техніки та історію рукоділля в блозі майстерні "Вузлик до вузлика".',
            canonicalUrl: `${process.env.BASE_URL || 'https://vuzlyk.com'}/blog${page > 1 ? '?page=' + page : ''}`,
            posts: posts,
            currentPage: page,
            totalPages: totalPages,
            hasPrevPage: page > 1,
            hasNextPage: page < totalPages,
            prevPage: page - 1,
            nextPage: page + 1,
            pageName: 'blog', 
            POSTS_PER_PAGE: POSTS_PER_PAGE
        });
    } catch (error) {
        console.error("[Blog Routes] Помилка завантаження списку статей блогу:", error);
        next(error);
    }
});

router.get('/:slug', async (req, res, next) => {
    try {
        const post = await Post.findOne({ slug: req.params.slug, isPublished: true }).lean();

        if (!post) {
            return res.status(404).render('404');
        }

        await Post.findByIdAndUpdate(post._id, { $inc: { views: 1 } });

        const pageTitle = post.metaTitle || `${post.title} | Блог майстерні "Вузлик до вузлика"`;
        const defaultMetaDesc = `${post.summary.substring(0, 150)}... Читайте в блозі майстерні Вузлик до вузлика про українські традиції та секрети вишивки.`;
        const metaDescription = post.metaDescription || defaultMetaDesc.substring(0, 160);
        
        // --- 👇 НАЧАЛО НОВЫХ ДАННЫХ ДЛЯ SEO 👇 ---

        const baseUrl = process.env.BASE_URL || 'https://vuzlyk.com';
        const postUrl = `${baseUrl}/blog/${post.slug}`;
        const mainImageUrl = post.imageUrl ? new URL(post.imageUrl, baseUrl).href : new URL('/images/og-image.jpg', baseUrl).href;
        
        // Очищаем текст статьи от HTML для articleBody
        const articleTextContent = post.content ? post.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';

         const emojiRegex = /[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g;
        const cleanTitleForBreadcrumb = post.title.replace(emojiRegex, '').trim();

        // Формируем JSON-LD
        const jsonLd = {
            "@context": "https://schema.org",
            "@graph": [
                {
                    "@type": "Article",
                    "mainEntityOfPage": {
                        "@type": "WebPage",
                        "@id": postUrl
                    },
                    "headline": post.metaTitle || post.title,
                    "description": post.metaDescription || post.summary,
                    "image": {
                        "@type": "ImageObject",
                        "url": mainImageUrl
                    },
                    "author": {
                        "@type": "Organization",
                        "name": post.authorDisplay || "Вузлик до вузлика",
                        "url": baseUrl
                    },
                    "publisher": {
                        "@type": "Organization",
                        "name": "Вузлик до вузлика",
                        "logo": {
                            "@type": "ImageObject",
                            "url": new URL('/images/logo.webp', baseUrl).href,
                            "width": 80,
                            "height": 50
                        }
                    },
                    "datePublished": post.publishedAt ? new Date(post.publishedAt).toISOString() : new Date(post.createdAt).toISOString(),
                    "dateModified": new Date(post.updatedAt).toISOString(),
                    "articleBody": articleTextContent,
                    "keywords": post.tags ? post.tags.join(", ") : undefined
                },
                {
                    "@type": "BreadcrumbList",
                    "itemListElement": [
                        {
                            "@type": "ListItem",
                            "position": 1,
                            "name": "Головна",
                            "item": baseUrl
                        },
                        {
                            "@type": "ListItem",
                            "position": 2,
                            "name": "Блог",
                            "item": `${baseUrl}/blog`
                        },
                        {
                            "@type": "ListItem",
                            "position": 3,
                            "name": cleanTitleForBreadcrumb 
                        }
                    ]
                }
            ]
        };
        
        // --- 👆 КОНЕЦ НОВЫХ ДАННЫХ ДЛЯ SEO 👆 ---

        res.render('blog/blog-post', { 
            pageTitle: pageTitle,
            metaDescription: metaDescription,
            canonicalUrl: postUrl,
            post: post,
            ogImage: mainImageUrl,
            jsonLd: jsonLd // <-- Передаем новый объект в шаблон
        });
    } catch (error) {
        console.error(`[Blog Routes] Помилка завантаження статті "${req.params.slug}":`, error);
        next(error);
    }
});

module.exports = router;