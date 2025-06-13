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

        res.render('blog/blog-post', { 
    pageTitle: pageTitle,
    metaDescription: metaDescription,
            canonicalUrl: `${process.env.BASE_URL || 'https://vuzlyk.com'}/blog/${post.slug}`,
            post: post,
            ogImage: post.imageUrl || `${process.env.BASE_URL || 'https://vuzlyk.com'}/images/og-image.jpg` 
        });
    } catch (error) {
        console.error(`[Blog Routes] Помилка завантаження статті "${req.params.slug}":`, error);
        next(error);
    }
});

module.exports = router;