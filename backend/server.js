const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const mysql = require('mysql2/promise'); // 使用promise版本
const Link = require('./models/Link');

// 数据库连接配置
const dbConfig = {
    host: process.env.MYSQL_HOST || '159.75.107.196',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || 'debezium',
    database: process.env.MYSQL_DATABASE || 'nav_website'
};

// 创建数据库连接池
const pool = mysql.createPool(dbConfig);

// 测试数据库连接
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('数据库连接成功');
        connection.release();
    } catch (error) {
        console.error('数据库连接失败:', error);
    }
}

testConnection();

const app = express();

// 配置CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'UPDATE', 'PUT', 'PATCH'],
    credentials: true
}));

app.use(express.json());

// 获取所有分类
app.get('/api/categories', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT DISTINCT category FROM links'
        );
        const categories = rows.map(row => row.category);
        res.json(categories);
    } catch (error) {
        res.status(500).json({ error: '获取分类失败' });
    }
});

// 添加新分类
app.post('/api/categories', async (req, res) => {
    try {
        const { category } = req.body;
        
        if (!category) {
            return res.status(400).json({ error: '分类名称不能为空' });
        }
        
        // 检查分类是否已存在
        const [existing] = await pool.query(
            'SELECT category FROM links WHERE category = ? LIMIT 1',
            [category]
        );
        
        if (existing.length > 0) {
            return res.status(400).json({ error: '该分类已存在' });
        }
        
        // 创建一个空链接来保存新分类
        const [result] = await pool.query(
            'INSERT INTO links (id, category, title, url) VALUES (?, ?, ?, ?)',
            [Date.now().toString(), category, '分类占位', 'http://example.com']
        );
        
        res.json({ message: '分类添加成功', category });
    } catch (error) {
        console.error('添加分类失败:', error);
        res.status(500).json({ error: '添加分类失败' });
    }
});

// 获取所有链接
app.get('/api/all-links', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM links');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: '获取所有链接失败' });
    }
});

// 获取指定分类的所有链接
app.get('/api/links/:category', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM links WHERE category = ?',
            [req.params.category]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: '获取链接失败' });
    }
});

// 添加新链接
app.post('/api/links', async (req, res) => {
    try {
        const { category, title, url, description } = req.body;
        
        if (!category || !title || !url) {
            return res.status(400).json({ error: '分类、标题和URL为必填项' });
        }

        let formattedUrl = url;
        if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
            formattedUrl = 'https://' + formattedUrl;
        }

        try {
            new URL(formattedUrl);
        } catch (error) {
            return res.status(400).json({ error: '无效的URL格式' });
        }
        
        const favicon = await getFavicon(formattedUrl);
        const id = Date.now().toString(); // 生成一个ID并保存下来重用
        
        const [result] = await pool.query(
            'INSERT INTO links (id, category, title, url, description, favicon) VALUES (?, ?, ?, ?, ?, ?)',
            [id, category, title, formattedUrl, description, favicon]
        );
        
        const [newLink] = await pool.query(
            'SELECT * FROM links WHERE id = ?',
            [id]  // 使用保存的ID
        );
        
        res.json({ message: '链接添加成功', link: newLink[0] });
    } catch (error) {
        res.status(500).json({ error: '添加链接失败' });
    }
});

// 删除链接
app.delete('/api/links/:id', async (req, res) => {
    try {
        const [result] = await pool.query(
            'DELETE FROM links WHERE id = ?',
            [req.params.id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: '链接不存在' });
        }
        
        res.json({ message: '链接删除成功' });
    } catch (error) {
        res.status(500).json({ error: '删除链接失败' });
    }
});

// 获取最近访问记录
app.get('/api/recent-visits', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM links WHERE lastVisited IS NOT NULL ORDER BY lastVisited DESC LIMIT 10'
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: '获取最近访问记录失败' });
    }
});

// 更新访问记录
app.post('/api/visit/:id', async (req, res) => {
    try {
        const [result] = await pool.query(
            'UPDATE links SET lastVisited = NOW(), visitCount = visitCount + 1 WHERE id = ?',
            [req.params.id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: '链接不存在' });
        }
        
        res.json({ message: '访问记录更新成功' });
    } catch (error) {
        res.status(500).json({ error: '更新访问记录失败' });
    }
});

// 搜索链接
app.get('/api/search', async (req, res) => {
    try {
        const { q } = req.query;
        const [rows] = await pool.query(
            'SELECT * FROM links WHERE title LIKE ? OR description LIKE ? OR category LIKE ?',
            [`%${q}%`, `%${q}%`, `%${q}%`]
        );
        res.json(rows);
    } catch (error) {
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
        res.status(500).json({ error: '获取链接预览失败' });
    }
});

// 导入链接
app.post('/api/import', async (req, res) => {
    try {
        const { links } = req.body;
        for (const link of links) {
            const favicon = await getFavicon(link.url);
            await pool.query(
                'INSERT INTO links (id, category, title, url, description, favicon) VALUES (?, ?, ?, ?, ?, ?)',
                [Date.now().toString(), link.category, link.title, link.url, link.description, favicon]
            );
        }
        res.json({ message: '链接导入成功' });
    } catch (error) {
        res.status(500).json({ error: '导入链接失败' });
    }
});

// 导出链接
app.get('/api/export', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM links');
        res.json(rows);
    } catch (error) {
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
            // 静默处理无效URL
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
                // 静默处理不可访问的favicon
                return null;
            }
        } catch (error) {
            // 静默处理页面内容获取失败
            return null;
        }
    } catch (error) {
        // 静默处理所有其他错误
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
        // 静默处理错误，返回默认值
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
        const [rows] = await pool.query('SELECT id, url FROM links');
        for (const link of rows) {
            try {
                await axios.head(link.url);
                await pool.query(
                    'UPDATE links SET isValid = true WHERE id = ?',
                    [link.id]
                );
            } catch (error) {
                await pool.query(
                    'UPDATE links SET isValid = false WHERE id = ?',
                    [link.id]
                );
            }
        }
    } catch (error) {
        console.error('检查链接失败:', error);
    }
}

// 定时任务：每天凌晨2点检查链接有效性
cron.schedule('0 2 * * *', () => {
    checkAllLinks();
});

// 添加在其他路由之前
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: '服务器正常运行' });
});

// 删除分类
app.delete('/api/categories/:category', async (req, res) => {
    try {
        const category = req.params.category;
        
        // 先检查分类是否存在
        const [existing] = await pool.query(
            'SELECT category FROM links WHERE category = ? LIMIT 1',
            [category]
        );
        
        if (existing.length === 0) {
            return res.status(404).json({ error: '分类不存在' });
        }
        
        // 删除该分类下的所有链接
        const [result] = await pool.query(
            'DELETE FROM links WHERE category = ?',
            [category]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: '删除分类失败：没有找到相关记录' });
        }
        
        res.json({ message: '分类删除成功' });
    } catch (error) {
        console.error('删除分类失败:', error);
        res.status(500).json({ 
            error: '删除分类失败',
            details: error.message 
        });
    }
});

// 更新链接
app.put('/api/links/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, url, description } = req.body;
        
        if (!title || !url) {
            return res.status(400).json({ error: '网站名称和地址不能为空' });
        }
        
        // 验证链接是否存在
        const [existing] = await pool.query(
            'SELECT id FROM links WHERE id = ?',
            [id]
        );
        
        if (existing.length === 0) {
            return res.status(404).json({ error: '链接不存在' });
        }
        
        const success = await Link.update(id, { title, url, description });
        
        if (success) {
            res.json({ message: '链接更新成功' });
        } else {
            res.status(404).json({ error: '链接不存在' });
        }
    } catch (error) {
        console.error('更新链接失败:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`服务器运行在端口 ${port}`);
}); 