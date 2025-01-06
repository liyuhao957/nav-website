const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const Link = require('./models/Link');

const app = express();

// 配置CORS
app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:5500', 'null'],
    methods: ['GET', 'POST', 'DELETE', 'UPDATE', 'PUT', 'PATCH'],
    credentials: true
}));

app.use(express.json());

// 连接MongoDB
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://liyuhao658:PndF4hROA11U7lZC@cluster0.srgfy.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('MongoDB连接成功');
}).catch(err => {
    console.error('MongoDB连接失败:', err);
});

// 获取所有分类
app.get('/api/categories', async (req, res) => {
    try {
        console.log('收到获取分类请求');
        const categories = await Link.distinct('category');
        console.log('数据库中的分类:', categories);
        res.json(categories);
    } catch (error) {
        console.error('获取分类失败:', error);
        res.status(500).json({ error: '获取分类失败' });
    }
});

// 获取所有链接
app.get('/api/all-links', async (req, res) => {
    try {
        console.log('收到获取所有链接请求');
        const links = await Link.find();
        console.log('数据库查询完成');
        console.log('找到的链接数量:', links.length);
        console.log('链接列表:', JSON.stringify(links, null, 2));
        res.json(links);
    } catch (error) {
        console.error('获取所有链接失败:', error);
        res.status(500).json({ error: '获取所有链接失败' });
    }
});

// 获取指定分类的所有链接
app.get('/api/links/:category', async (req, res) => {
    try {
        const category = req.params.category;
        console.log('收到获取链接请求, 分类:', category);
        
        const links = await Link.find({ category: category });
        console.log('找到的链接数量:', links.length);
        console.log('链接列表:', JSON.stringify(links, null, 2));
        
        res.json(links);
    } catch (error) {
        console.error('获取链接失败:', error);
        res.status(500).json({ error: '获取链接失败' });
    }
});

// 添加新分类
app.post('/api/categories', async (req, res) => {
    try {
        const { category } = req.body;
        const existingCategory = await Link.findOne({ category });
        if (existingCategory) {
            return res.status(400).json({ error: '分类已存在' });
        }
        // 创建一个新的分类文档
        const newLink = new Link({ 
            category,
            title: category,  // 使用分类名作为标题
            url: '#',         // 使用占位符URL
            description: `${category}分类` // 添加描述
        });
        await newLink.save();
        res.json({ message: '分类添加成功' });
    } catch (error) {
        console.error('添加分类失败:', error);
        res.status(500).json({ error: '添加分类失败' });
    }
});

// 添加新链接
app.post('/api/links', async (req, res) => {
    try {
        const { category, title, url, description } = req.body;
        console.log('收到添加链接请求:', { category, title, url, description });
        
        // 验证必填字段
        if (!category || !title || !url) {
            console.log('缺少必填字段');
            return res.status(400).json({ error: '分类、标题和URL为必填项' });
        }

        // 格式化URL
        let formattedUrl = url;
        if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
            formattedUrl = 'https://' + formattedUrl;
        }

        // 验证URL格式
        try {
            new URL(formattedUrl);
        } catch (error) {
            console.log('无效的URL格式:', formattedUrl);
            return res.status(400).json({ error: '无效的URL格式' });
        }
        
        // 获取网站favicon
        const favicon = await getFavicon(formattedUrl);
        console.log('获取到的favicon:', favicon);
        
        const newLink = new Link({
            category,
            title,
            url: formattedUrl,
            description,
            favicon,
            lastVisited: null,
            visitCount: 0
        });
        
        console.log('准备保存新链接:', newLink);
        await newLink.save();
        console.log('新链接保存成功');
        res.json({ message: '链接添加成功', link: newLink });
    } catch (error) {
        console.error('添加链接失败:', error);
        res.status(500).json({ error: '添加链接失败' });
    }
});

// 删除链接
app.delete('/api/links/:id', async (req, res) => {
    try {
        const linkId = req.params.id;
        console.log('收到删除链接请求, ID:', linkId);
        
        const result = await Link.findByIdAndDelete(linkId);
        console.log('删除结果:', result);
        
        if (!result) {
            console.log('链接不存在');
            return res.status(404).json({ error: '链接不存在' });
        }
        
        console.log('链接删除成功');
        res.json({ message: '链接删除成功' });
    } catch (error) {
        console.error('删除链接失败:', error);
        res.status(500).json({ error: '删除链接失败' });
    }
});

// 获取最近访问记录
app.get('/api/recent-visits', async (req, res) => {
    try {
        const recentLinks = await Link.find({ lastVisited: { $ne: null } })
            .sort({ lastVisited: -1 })
            .limit(10);
        res.json(recentLinks);
    } catch (error) {
        console.error('获取最近访问记录失败:', error);
        res.status(500).json({ error: '获取最近访问记录失败' });
    }
});

// 更新访问记录
app.post('/api/visit/:id', async (req, res) => {
    try {
        const link = await Link.findById(req.params.id);
        if (!link) {
            return res.status(404).json({ error: '链接不存在' });
        }
        
        link.lastVisited = new Date();
        link.visitCount += 1;
        await link.save();
        
        res.json({ message: '访问记录更新成功' });
    } catch (error) {
        console.error('更新访问记录失败:', error);
        res.status(500).json({ error: '更新访问记录失败' });
    }
});

// 搜索链接
app.get('/api/search', async (req, res) => {
    try {
        const { q } = req.query;
        const regex = new RegExp(q, 'i');
        const links = await Link.find({
            $or: [
                { title: regex },
                { description: regex },
                { category: regex }
            ]
        }).limit(10);
        res.json(links);
    } catch (error) {
        console.error('搜索失败:', error);
        res.status(500).json({ error: '搜索失败' });
    }
});

// 获取链接预览
app.get('/api/preview', async (req, res) => {
    try {
        const { url } = req.query;
        const preview = await getWebsitePreview(url);
        res.json(preview);
    } catch (error) {
        console.error('获取链接预览失败:', error);
        res.status(500).json({ error: '获取链接预览失败' });
    }
});

// 导入链接
app.post('/api/import', async (req, res) => {
    try {
        const { links } = req.body;
        for (const link of links) {
            const favicon = await getFavicon(link.url);
            const newLink = new Link({
                ...link,
                favicon,
                lastVisited: null,
                visitCount: 0
            });
            await newLink.save();
        }
        res.json({ message: '链接导入成功' });
    } catch (error) {
        console.error('导入链接失败:', error);
        res.status(500).json({ error: '导入链接失败' });
    }
});

// 导出链接
app.get('/api/export', async (req, res) => {
    try {
        const links = await Link.find({}, { _id: 0, __v: 0 });
        res.json(links);
    } catch (error) {
        console.error('导出链接失败:', error);
        res.status(500).json({ error: '导出链接失败' });
    }
});

// 检查链接有效性
app.post('/api/check-links', async (req, res) => {
    try {
        // 启动异步任务检查链接
        checkAllLinks();
        res.json({ message: '链接检查已开始' });
    } catch (error) {
        console.error('检查链接失败:', error);
        res.status(500).json({ error: '检查链接失败' });
    }
});

// 辅助函数：获取网站favicon
async function getFavicon(url) {
    try {
        // 验证URL格式
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }

        try {
            new URL(url); // 验证URL是否有效
        } catch (error) {
            console.error('无效的URL:', url);
            return null;
        }

        try {
            const { data } = await axios.get(url);
            const $ = cheerio.load(data);
            
            // 尝试从link标签获取favicon
            let favicon = $('link[rel="icon"]').attr('href') ||
                         $('link[rel="shortcut icon"]').attr('href') ||
                         $('link[rel="apple-touch-icon"]').attr('href');
            
            // 如果没有找到favicon，使用默认的favicon路径
            if (!favicon) {
                const urlObj = new URL(url);
                favicon = `${urlObj.protocol}//${urlObj.hostname}/favicon.ico`;
            }
            
            // 如果favicon是相对路径，转换为绝对路径
            if (favicon && !favicon.startsWith('http')) {
                const urlObj = new URL(url);
                favicon = new URL(favicon, urlObj.origin).href;
            }
            
            // 验证favicon URL是否可访问
            try {
                await axios.head(favicon);
                return favicon;
            } catch (error) {
                console.error('Favicon不可访问:', favicon);
                return null;
            }
        } catch (error) {
            console.error('获取页面内容失败:', error.message);
            return null;
        }
    } catch (error) {
        console.error('获取favicon失败:', error.message);
        return null;
    }
}

// 辅助函数：获取网站预览信息
async function getWebsitePreview(url) {
    try {
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);
        
        return {
            title: $('title').text() || '',
            description: $('meta[name="description"]').attr('content') || '',
            favicon: await getFavicon(url),
            url
        };
    } catch (error) {
        console.error('获取网站预览失败:', error);
        return {
            title: '',
            description: '',
            favicon: null,
            url
        };
    }
}

// 辅助函数：检查所有链接的有效性
async function checkAllLinks() {
    try {
        const links = await Link.find();
        for (const link of links) {
            try {
                await axios.head(link.url);
                link.isValid = true;
            } catch (error) {
                link.isValid = false;
            }
            await link.save();
        }
    } catch (error) {
        console.error('检查链接失败:', error);
    }
}

// 定时任务：每天凌晨2点检查链接有效性
cron.schedule('0 2 * * *', () => {
    checkAllLinks();
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`服务器运行在端口 ${port}`);
}); 