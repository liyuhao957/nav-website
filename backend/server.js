const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const mysql = require('mysql2/promise'); // 使用promise版本
const Link = require('./models/Link');

// 数据库连接配置
const dbConfig = {
    host: '159.75.107.196',
    user: 'root',
    password: 'debezium',
    database: 'nav_website',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
};

// 创建数据库连接池
const pool = mysql.createPool(dbConfig);

// 监听连接池事件
pool.on('connection', () => {
    console.log('新的数据库连接已创建');
});

pool.on('release', () => {
    console.log('数据库连接已释放');
});

// 添加连接池事件监听
pool.on('acquire', function (connection) {
    console.log('连接已获取 | 连接ID:', connection.threadId);
});

pool.on('connection', function (connection) {
    console.log('新连接已创建 | 连接ID:', connection.threadId);
});

pool.on('release', function (connection) {
    console.log('连接已释放 | 连接ID:', connection.threadId);
});

pool.on('enqueue', function () {
    console.log('等待可用连接...');
});

// 添加错误处理
pool.on('error', (err) => {
    console.error('数据库池错误:', err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
        console.log('数据库连接断开，正在重新连接...');
        testConnection();
    }
});

// 封装数据库查询函数
async function executeQuery(sql, params = []) {
    let connection;
    try {
        console.log('正在获取数据库连接...');
        connection = await pool.getConnection();
        console.log(`执行查询 | 连接ID: ${connection.threadId} | SQL: ${sql}`);
        const [results] = await connection.query(sql, params);
        return results;
    } catch (error) {
        console.error('数据库查询错误:', error);
        throw error;
    } finally {
        if (connection) {
            console.log(`查询完成，释放连接 | 连接ID: ${connection.threadId}`);
            connection.release();
        }
    }
}

// 测试数据库连接
async function testConnection() {
    try {
        console.log('测试数据库连接...');
        const connection = await pool.getConnection();
        console.log('数据库连接成功');
        connection.release();
    } catch (error) {
        console.error('数据库连接失败:', error);
    } finally {
        // 使用 pool.getConnection 获取连接数
        const [rows] = await pool.query('SHOW STATUS LIKE "Threads_connected"');
        console.log('当前数据库连接数:', rows[0].Value);
    }
}

// 标记连接池状态
let isPoolClosing = false;

// 在应用退出时清理连接池
process.on('SIGINT', async () => {
    if (isPoolClosing) {
        console.log('连接池已经在关闭中...');
        return;
    }
    
    console.log('应用正在关闭，清理连接池...');
    isPoolClosing = true;
    
    try {
        await pool.end();
        console.log('连接池已成功关闭');
        process.exit(0);
    } catch (error) {
        console.error('关闭连接池时出错:', error);
        process.exit(1);
    }
});

// 定期检查连接池状态
setInterval(async () => {
    try {
        const [rows] = await pool.query('SHOW STATUS LIKE "Threads_connected"');
        console.log('当前数据库连接数:', rows[0].Value);
    } catch (error) {
        console.error('检查连接池状态失败:', error);
    }
}, 30000); // 每30秒检查一次

testConnection();

const app = express();

// 配置CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'UPDATE', 'PUT', 'PATCH'],
    credentials: true
}));

app.use(express.json());

// 确保在每个请求完成后释放连接
app.use((req, res, next) => {
    req.on('end', () => {
        if (req.dbConnection) {
            req.dbConnection.release();
            console.log('请求结束，释放数据库连接');
        }
    });
    next();
});

// 获取所有链接
app.get('/api/links/all', async (req, res) => {
    try {
        const rows = await executeQuery('SELECT * FROM links ORDER BY category, title');
        res.json(rows);
    } catch (error) {
        console.error('获取所有链接失败:', error);
        res.status(500).json({ error: '获取所有链接失败' });
    }
});

// 获取指定分类的所有链接
app.get('/api/links/:category', async (req, res) => {
    try {
        if (req.params.category === 'all') {
            const rows = await executeQuery('SELECT * FROM links ORDER BY category, title');
            return res.json(rows);
        }
        
        const rows = await executeQuery(
            'SELECT * FROM links WHERE category = ? ORDER BY title',
            [req.params.category]
        );
        res.json(rows);
    } catch (error) {
        console.error('获取链接失败:', error);
        res.status(500).json({ error: '获取链接失败' });
    }
});

// 获取所有分类
app.get('/api/categories', async (req, res) => {
    try {
        const sort = req.query.sort || 'desc';
        const [categories] = await pool.query(
            'SELECT name FROM categories ORDER BY sort_order ' + (sort === 'desc' ? 'DESC' : 'ASC')
        );
        res.json(categories.map(category => category.name));
    } catch (error) {
        console.error('获取分类失败:', error);
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
        
        // 开始事务
        const connection = await pool.getConnection();
        await connection.beginTransaction();
        
        try {
            // 检查分类是否已存在
            const [existing] = await connection.query(
                'SELECT name FROM categories WHERE name = ?',
                [category]
            );
            
            if (existing.length > 0) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({ error: '该分类已存在' });
            }
            
            // 获取当前最大的sort_order
            const [maxOrder] = await connection.query(
                'SELECT COALESCE(MAX(sort_order), 0) as maxOrder FROM categories'
            );
            const newOrder = maxOrder[0].maxOrder + 1;
            
            // 添加到categories表
            await connection.query(
                'INSERT INTO categories (name, sort_order) VALUES (?, ?)',
                [category, newOrder]
            );
            
            // 创建一个空链接来保存新分类
            await connection.query(
                'INSERT INTO links (id, category, title, url) VALUES (?, ?, ?, ?)',
                [Date.now().toString(), category, '分类占位', 'http://example.com']
            );
            
            await connection.commit();
            connection.release();
            
            res.json({ message: '分类添加成功', category });
        } catch (error) {
            await connection.rollback();
            connection.release();
            throw error;
        }
    } catch (error) {
        console.error('添加分类失败:', error);
        res.status(500).json({ error: '添加分类失败' });
    }
});

// 获取所有链接
app.get('/api/all-links', async (req, res) => {
    try {
        const rows = await executeQuery('SELECT * FROM links');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: '获取所有链接失败' });
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
        const id = Date.now().toString();
        
        await executeQuery(
            'INSERT INTO links (id, category, title, url, description, favicon) VALUES (?, ?, ?, ?, ?, ?)',
            [id, category, title, formattedUrl, description, favicon]
        );
        
        const newLink = await executeQuery(
            'SELECT * FROM links WHERE id = ?',
            [id]
        );
        
        res.json({ message: '链接添加成功', link: newLink[0] });
    } catch (error) {
        res.status(500).json({ error: '添加链接失败' });
    }
});

// 删除链接
app.delete('/api/links/:id', async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 获取要删除的链接所属的分类
        const [link] = await connection.query(
            'SELECT category FROM links WHERE id = ?',
            [req.params.id]
        );

        if (link.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({ error: '链接不存在' });
        }

        const category = link[0].category;

        // 删除链接
        await connection.query(
            'DELETE FROM links WHERE id = ?',
            [req.params.id]
        );

        // 检查该分类下是否还有其他链接
        const [remainingLinks] = await connection.query(
            'SELECT id FROM links WHERE category = ? LIMIT 1',
            [category]
        );

        // 如果没有其他链接，删除分类
        if (remainingLinks.length === 0) {
            await connection.query(
                'DELETE FROM categories WHERE name = ?',
                [category]
            );
        }

        await connection.commit();
        connection.release();
        res.json({ message: '链接删除成功' });
    } catch (error) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }
        console.error('删除链接失败:', error);
        res.status(500).json({ error: '删除链接失败' });
    }
});

// 获取最近访问记录
app.get('/api/recent-visits', async (req, res) => {
    try {
        const rows = await executeQuery(
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
        const result = await executeQuery(
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
        const rows = await executeQuery(
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
    const batchSize = 5;
    try {
        const links = await executeQuery('SELECT id, url FROM links');
        for (let i = 0; i < links.length; i += batchSize) {
            const batch = links.slice(i, i + batchSize);
            await Promise.all(batch.map(async (link) => {
                try {
                    await axios.head(link.url);
                    await executeQuery(
                        'UPDATE links SET isValid = true WHERE id = ?',
                        [link.id]
                    );
                } catch (error) {
                    await executeQuery(
                        'UPDATE links SET isValid = false WHERE id = ?',
                        [link.id]
                    );
                }
            }));
            // 每个批次处理完后等待一小段时间
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    } catch (error) {
        console.error('检查链接失败:', error);
    }
}

// 定时任务：每天凌晨2点检查链接有效性
let isCheckingLinks = false;
cron.schedule('0 2 * * *', async () => {
    if (!isCheckingLinks) {
        isCheckingLinks = true;
        await checkAllLinks();
        isCheckingLinks = false;
    }
});

// 添加在其他路由之前
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: '服务器正常运行' });
});

// 删除分类
app.delete('/api/categories/:category', async (req, res) => {
    try {
        const category = req.params.category;
        
        // 开始事务
        const connection = await pool.getConnection();
        await connection.beginTransaction();
        
        try {
            // 删除该分类下的所有链接
            await connection.query(
                'DELETE FROM links WHERE category = ?',
                [category]
            );
            
            // 删除categories表中的分类
            await connection.query(
                'DELETE FROM categories WHERE name = ?',
                [category]
            );
            
            // 提交事务
            await connection.commit();
            connection.release();
            
            res.json({ message: '分类删除成功' });
        } catch (error) {
            await connection.rollback();
            connection.release();
            throw error;
        }
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

// 更新分类名称
app.put('/api/categories/:oldCategory', async (req, res) => {
    console.log('更新分类请求:', {
        oldCategory: req.params.oldCategory,
        newCategory: req.body.newCategory
    });
    
    try {
        const { oldCategory } = req.params;
        const { newCategory } = req.body;
        
        if (!newCategory) {
            return res.status(400).json({ error: '新分类名称不能为空' });
        }
        
        // 开始事务
        const connection = await pool.getConnection();
        await connection.beginTransaction();
        
        try {
            console.log('开始更新分类...');
            
            // 更新链接表中的分类
            const [updateResult] = await connection.query(
                'UPDATE links SET category = ? WHERE category = ?',
                [newCategory, oldCategory]
            );
            console.log('更新链接结果:', updateResult);
            
            // 提交事务
            await connection.commit();
            console.log('事务提交成功');
            
            res.json({ message: '分类更新成功' });
        } catch (error) {
            console.error('更新分类事务失败:', error);
            // 回滚事务
            await connection.rollback();
            res.status(500).json({ error: '更新分类失败: ' + error.message });
        } finally {
            // 释放连接
            connection.release();
            console.log('数据库连接已释放');
        }
    } catch (error) {
        console.error('更新分类失败:', error);
        res.status(500).json({ error: '处理更新分类请求失败: ' + error.message });
    }
});

// 添加分类重新排序的API端点
app.post('/api/categories/reorder', async (req, res) => {
    const { categories } = req.body;
    
    if (!Array.isArray(categories) || categories.length === 0) {
        return res.status(400).json({ error: '无效的分类数组' });
    }

    try {
        // 开始事务
        await pool.query('START TRANSACTION');

        // 更新每个分类的排序
        for (let i = 0; i < categories.length; i++) {
            const category = categories[i];
            const order = categories.length - i; // 倒序，最后一个是1
            await pool.query(
                'UPDATE categories SET sort_order = ? WHERE name = ?',
                [order, category]
            );
        }

        // 提交事务
        await pool.query('COMMIT');
        
        res.json({ message: '分类顺序更新成功' });
    } catch (error) {
        // 如果出错，回滚事务
        await pool.query('ROLLBACK');
        console.error('更新分类顺序失败:', error);
        res.status(500).json({ error: '更新分类顺序失败' });
    }
});

// 添加初始化categories表的函数
async function initializeCategoriesTable() {
    try {
        // 创建categories表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS categories (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE,
                sort_order INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 从links表中获取所有唯一的分类
        const [categories] = await pool.query(`
            SELECT category, MIN(id) as first_id
            FROM links 
            WHERE category IS NOT NULL 
            GROUP BY category
            ORDER BY first_id
        `);

        // 为每个分类创建记录
        for (let i = 0; i < categories.length; i++) {
            const category = categories[i].category;
            await pool.query(
                'INSERT IGNORE INTO categories (name, sort_order) VALUES (?, ?)',
                [category, categories.length - i]
            );
        }

        console.log('Categories表初始化完成');
    } catch (error) {
        console.error('初始化categories表失败:', error);
        throw error;
    }
}

// 在应用启动时初始化表
testConnection().then(() => {
    initializeCategoriesTable().then(() => {
        const port = process.env.PORT || 3000;
        app.listen(port, () => {
            console.log(`服务器运行在端口 ${port}`);
        });
    });
}); 