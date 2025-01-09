const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const mysql = require('mysql2/promise'); // 使用promise版本
const Link = require('./models/Link');
const Note = require('./models/Note');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// 配置multer存储
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const iconPath = path.join(__dirname, '../frontend/icons');
        // 确保目录存在
        if (!fs.existsSync(iconPath)) {
            fs.mkdirSync(iconPath, { recursive: true });
        }
        cb(null, iconPath);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });

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
        const [results] = await connection.execute(sql, params);
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

// 启用CORS
app.use(cors());

// 添加缓存控制中间件
app.use((req, res, next) => {
    // API 请求禁用缓存
    if (req.path.startsWith('/api/')) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
    }
    // 静态资源（如图标）使用短期缓存
    else if (req.path.startsWith('/icons/')) {
        res.set('Cache-Control', 'public, max-age=3600, must-revalidate'); // 1小时缓存
    }
    next();
});

// 解析JSON请求体
app.use(express.json());

// 设置静态文件服务
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/icons', express.static(path.join(__dirname, '../frontend/icons')));

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
        console.log('\n[添加链接] 开始处理请求:', { category, title, url, description });
        
        if (!category || !title || !url) {
            console.log('[添加链接] 参数验证失败：缺少必要参数');
            return res.status(400).json({ error: '分类、标题和URL为必填项' });
        }

        let formattedUrl = url;
        if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
            formattedUrl = 'https://' + formattedUrl;
            console.log('[添加链接] 格式化URL:', formattedUrl);
        }

        try {
            new URL(formattedUrl);
        } catch (error) {
            console.log('[添加链接] 无效的URL格式:', error.message);
            return res.status(400).json({ error: '无效的URL格式' });
        }
        
        // 生成链接ID
        const id = Date.now().toString();
        console.log('[添加链接] 生成的链接ID:', id);
        
        console.log('[添加链接] 开始获取favicon...');
        // 先添加链接，使用默认favicon
        await executeQuery(
            'INSERT INTO links (id, category, title, url, description, favicon) VALUES (?, ?, ?, ?, ?, ?)',
            [id, category, title, formattedUrl, description, '/favicon.svg']
        );
        
        // 异步获取favicon，不阻塞响应
        (async () => {
            try {
                console.log('[添加链接] 开始异步获取favicon...');
                const iconUrl = await getFavicon(formattedUrl);
                if (iconUrl) {
                    console.log('[添加链接] 获取到favicon，更新数据库:', iconUrl);
                    await executeQuery(
                        'UPDATE links SET favicon = ? WHERE id = ?',
                        [iconUrl, id]
                    );
                    console.log('[添加链接] Favicon更新成功');
                } else {
                    console.log('[添加链接] 未获取到favicon，保持默认图标');
                }
            } catch (error) {
                console.error('[添加链接] 获取favicon失败:', error);
            }
        })();
        
        // 获取新添加的链接信息
        const newLink = await executeQuery(
            'SELECT * FROM links WHERE id = ?',
            [id]
        );
        
        console.log('[添加链接] 链接添加成功:', newLink[0]);
        res.json({ message: '链接添加成功', link: newLink[0] });
    } catch (error) {
        console.error('[添加链接] 添加链接失败:', error);
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
    let connection;
    try {
        const { links } = req.body;
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 获取当前最大的排序值
        const [maxOrder] = await connection.query(
            'SELECT MAX(sort_order) as maxOrder FROM categories'
        );
        let currentOrder = maxOrder[0].maxOrder || 0;

        // 处理每个链接
        for (const link of links) {
            // 检查分类是否存在
            const [existingCategory] = await connection.query(
                'SELECT name FROM categories WHERE name = ?',
                [link.category]
            );

            // 如果分类不存在，创建新分类
            if (existingCategory.length === 0) {
                currentOrder += 1;
                await connection.query(
                    'INSERT INTO categories (name, sort_order) VALUES (?, ?)',
                    [link.category, currentOrder]
                );
            }

            // 添加链接
            const favicon = await getFavicon(link.url);
            await connection.query(
                'INSERT INTO links (id, category, title, url, description, favicon) VALUES (?, ?, ?, ?, ?, ?)',
                [Date.now().toString(), link.category, link.title, link.url, link.description, favicon]
            );
        }

        await connection.commit();
        res.json({ message: '链接导入成功' });
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error('导入链接失败:', error);
        res.status(500).json({ error: '导入链接失败' });
    } finally {
        if (connection) {
            connection.release();
        }
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

// 辅助函数：获取网站favicon
async function getFavicon(url) {
    try {
        console.log('\n[getFavicon] 开始获取favicon, URL:', url);
        // 验证URL格式
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
            console.log('[getFavicon] 添加https前缀后的URL:', url);
        }

        try {
            new URL(url); // 验证URL是否有效
        } catch (error) {
            console.log('[getFavicon] 无效的URL格式:', error.message);
            return null;
        }

        try {
            const requestConfig = {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                },
                timeout: 5000
            };

            console.log('[getFavicon] 开始获取页面内容...');
            const { data } = await axios.get(url, requestConfig);
            console.log('[getFavicon] 页面内容获取成功，开始解析...');
            const $ = cheerio.load(data);
            
            // 尝试从link标签获取favicon
            let favicon = $('link[rel="icon"]').attr('href') ||
                         $('link[rel="shortcut icon"]').attr('href') ||
                         $('link[rel="apple-touch-icon"]').attr('href');
            
            console.log('[getFavicon] 从页面解析到的favicon:', favicon);
            
            // 如果没有找到favicon，使用默认的favicon路径
            if (!favicon) {
                const urlObj = new URL(url);
                favicon = `${urlObj.protocol}//${urlObj.hostname}/favicon.ico`;
                console.log('[getFavicon] 未找到favicon，使用默认路径:', favicon);
            }
            
            // 如果favicon是相对路径，转换为绝对路径
            if (favicon && !favicon.startsWith('http')) {
                const urlObj = new URL(url);
                const oldFavicon = favicon;
                favicon = new URL(favicon, urlObj.origin).href;
                console.log('[getFavicon] 将相对路径转换为绝对路径:', oldFavicon, '->', favicon);
            }
            
            // 验证favicon URL是否可访问
            try {
                console.log('[getFavicon] 开始验证favicon可访问性:', favicon);
                // 检查是否是华为的链接
                const isHuaweiLink = favicon.includes('developer.huawei.com');
                console.log('[getFavicon] 是否是华为链接:', isHuaweiLink);

                if (isHuaweiLink) {
                    console.log('[getFavicon] 使用GET请求验证华为favicon');
                    const response = await axios.get(favicon, requestConfig);
                    console.log('[getFavicon] 华为favicon验证结果:', response.status);
                } else {
                    console.log('[getFavicon] 使用HEAD请求验证favicon');
                    const response = await axios.head(favicon);
                    console.log('[getFavicon] Favicon验证结果:', response.status);
                }
                console.log('[getFavicon] Favicon验证成功，返回URL:', favicon);
                return favicon;
            } catch (error) {
                console.error('[getFavicon] Favicon验证失败:', error.message);
                if (error.response) {
                    console.error('[getFavicon] 响应状态码:', error.response.status);
                    console.error('[getFavicon] 响应头:', JSON.stringify(error.response.headers, null, 2));
                }
                return null;
            }
        } catch (error) {
            console.error('[getFavicon] 获取页面内容失败:', error.message);
            if (error.response) {
                console.error('[getFavicon] 响应状态码:', error.response.status);
                console.error('[getFavicon] 响应头:', JSON.stringify(error.response.headers, null, 2));
            }
            return null;
        }
    } catch (error) {
        console.error('[getFavicon] 获取favicon过程中发生错误:', error.message);
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
        console.log('开始检查所有链接...');
        const links = await executeQuery('SELECT id, title, url FROM links');
        console.log(`总共需要检查 ${links.length} 个链接`);

        for (let i = 0; i < links.length; i += batchSize) {
            const batch = links.slice(i, i + batchSize);
            console.log(`正在检查第 ${i + 1} 到 ${Math.min(i + batchSize, links.length)} 个链接...`);

            await Promise.all(batch.map(async (link) => {
                try {
                    console.log(`检查链接: ${link.url} (${link.title})`);

                    // 验证URL格式
                    try {
                        new URL(link.url);
                    } catch (error) {
                        console.error(`无效的URL格式: ${link.url}`);
                        await executeQuery(
                            'UPDATE links SET isValid = false WHERE id = ?',
                            [link.id]
                        );
                        return;
                    }

                    // 检查是否是华为的链接
                    const isHuaweiLink = link.url.includes('developer.huawei.com');
                    const requestConfig = {
                        validateStatus: null, // 不抛出HTTP错误
                        timeout: 5000, // 5秒超时
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                        }
                    };

                    // 对华为链接使用GET请求，其他链接使用HEAD请求
                    const response = await (isHuaweiLink ? 
                        axios.get(link.url, requestConfig) : 
                        axios.head(link.url, requestConfig));
                    
                    // 只有2xx状态码才认为是有效的
                    const isValid = response.status >= 200 && response.status < 300;
                    console.log(`链接 ${link.url} 状态码: ${response.status}, 有效性: ${isValid}`);
                    
                    await executeQuery(
                        'UPDATE links SET isValid = ? WHERE id = ?',
                        [isValid, link.id]
                    );
                } catch (error) {
                    // 任何错误（网络错误、超时等）都标记为无效
                    console.error(`检查链接 ${link.url} 失败:`, error.message);
                    await executeQuery(
                        'UPDATE links SET isValid = false WHERE id = ?',
                        [link.id]
                    );
                }
            }));
            // 每个批次处理完后等待一小段时间
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        console.log('所有链接检查完成');
    } catch (error) {
        console.error('检查链接失败:', error);
        throw error;
    }
}

// 检查链接有效性
app.post('/api/check-links', async (req, res) => {
    try {
        console.log('收到检查链接请求');
        await checkAllLinks();
        console.log('获取检查结果...');
        // 获取检查结果，包括标题信息
        const results = await executeQuery('SELECT id, title, url, isValid FROM links');
        console.log(`检查完成，共 ${results.length} 个链接`);
        console.log('有效链接数:', results.filter(r => r.isValid).length);
        console.log('无效链接数:', results.filter(r => !r.isValid).length);
        
        res.json({ 
            message: '链接检查完成',
            results: results
        });
    } catch (error) {
        console.error('检查链接失败:', error);
        res.status(500).json({ error: '检查链接失败' });
    }
});

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

        // 获取新的favicon
        console.log('[updateLink] 开始获取新的favicon...');
        const newFavicon = await getFavicon(url);
        
        // 更新链接信息，包括新的favicon
        const success = await Link.update(id, { 
            title, 
            url, 
            description,
            favicon: newFavicon || '/favicon.svg' // 如果获取失败则使用默认favicon
        });
        
        if (success) {
            // 获取更新后的完整链接信息
            const [updatedLink] = await pool.query(
                'SELECT * FROM links WHERE id = ?',
                [id]
            );
            
            if (updatedLink.length > 0) {
                res.json({ 
                    message: '链接更新成功',
                    link: updatedLink[0]
                });
            } else {
                res.status(404).json({ error: '无法获取更新后的链接信息' });
            }
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
            
            // 检查新分类名称是否已存在
            const [existingCategory] = await connection.query(
                'SELECT name FROM categories WHERE name = ?',
                [newCategory]
            );
            
            if (existingCategory.length > 0) {
                await connection.rollback();
                return res.status(400).json({ error: '该分类名称已存在' });
            }
            
            // 更新 categories 表中的分类名称
            const [updateCategoryResult] = await connection.query(
                'UPDATE categories SET name = ? WHERE name = ?',
                [newCategory, oldCategory]
            );
            
            // 更新 links 表中的分类名称
            const [updateLinksResult] = await connection.query(
                'UPDATE links SET category = ? WHERE category = ?',
                [newCategory, oldCategory]
            );
            
            // 提交事务
            await connection.commit();
            console.log('事务提交成功');
            
            res.json({ 
                message: '分类更新成功',
                categoryUpdated: updateCategoryResult.affectedRows > 0,
                linksUpdated: updateLinksResult.affectedRows
            });
        } catch (error) {
            console.error('更新分类事务失败:', error);
            await connection.rollback();
            res.status(500).json({ error: '更新分类失败: ' + error.message });
        } finally {
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

// 添加初始化notes表的函数
async function initializeNotesTable() {
    try {
        // 创建notes表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS notes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                tags VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                sort_order INT DEFAULT 0
            )
        `);

        // 检查sort_order字段是否存在
        const [columns] = await pool.query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'notes' 
            AND COLUMN_NAME = 'sort_order'
        `);

        // 如果字段不存在，添加它
        if (columns.length === 0) {
            await pool.query(`
                ALTER TABLE notes 
                ADD COLUMN sort_order INT DEFAULT 0
            `);

            // 根据现有笔记的ID顺序初始化sort_order
            const [notes] = await pool.query('SELECT id FROM notes ORDER BY id DESC');
            for (let i = 0; i < notes.length; i++) {
                await pool.query(
                    'UPDATE notes SET sort_order = ? WHERE id = ?',
                    [notes.length - i, notes[i].id]
                );
            }
        }

        console.log('Notes表初始化完成');
    } catch (error) {
        console.error('初始化notes表失败:', error);
        throw error;
    }
}

// 在应用启动时初始化表
testConnection().then(() => {
    Promise.all([
        initializeCategoriesTable(),
        initializeNotesTable()
    ]).then(() => {
        const port = process.env.PORT || 3000;
        app.listen(port, () => {
            console.log(`服务器运行在端口 ${port}`);
        });
    });
});

// 获取所有笔记（带排序）
app.get('/api/notes', async (req, res) => {
    try {
        const sort = req.query.sort || 'desc'; // 默认按时间降序
        const orderBy = req.query.orderBy || 'created_at'; // 可以是 'created_at' 或 'sort_order'
        
        let query;
        if (orderBy === 'sort_order') {
            query = `SELECT * FROM notes ORDER BY sort_order ${sort === 'desc' ? 'DESC' : 'ASC'}`;
        } else {
            query = `SELECT * FROM notes ORDER BY created_at ${sort === 'desc' ? 'DESC' : 'ASC'}, id ${sort === 'desc' ? 'DESC' : 'ASC'}`;
        }
        
        const rows = await executeQuery(query);
        res.json(rows);
    } catch (error) {
        console.error('获取笔记失败:', error);
        res.status(500).json({ error: '获取笔记失败' });
    }
});

// 导出笔记
app.get('/api/notes/export', async (req, res) => {
    try {
        const rows = await executeQuery('SELECT * FROM notes ORDER BY sort_order DESC');
        res.json(rows);
    } catch (error) {
        console.error('导出笔记失败:', error);
        res.status(500).json({ error: '导出笔记失败' });
    }
});

// 导入笔记
app.post('/api/notes/import', async (req, res) => {
    let connection;
    try {
        const { notes } = req.body;
        
        if (!Array.isArray(notes)) {
            return res.status(400).json({ error: '无效的笔记数据格式' });
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 获取当前最大的排序值
        const [maxOrder] = await connection.query(
            'SELECT COALESCE(MAX(sort_order), 0) as maxOrder FROM notes'
        );
        let currentOrder = maxOrder[0].maxOrder || 0;

        // 处理每个笔记
        for (const note of notes) {
            // 转义特殊字符
            const escapedTitle = note.title.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
            const escapedContent = note.content.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
            const escapedTags = note.tags ? note.tags.replace(/[\u0000-\u001F\u007F-\u009F]/g, '') : null;

            currentOrder += 1;
            await connection.query(
                'INSERT INTO notes (title, content, tags, sort_order) VALUES (?, ?, ?, ?)',
                [escapedTitle, escapedContent, escapedTags, currentOrder]
            );
        }

        await connection.commit();
        res.json({ message: '笔记导入成功', count: notes.length });
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error('导入笔记失败:', error);
        res.status(500).json({ error: '导入笔记失败' });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

// 搜索笔记
app.get('/api/notes/search', async (req, res) => {
    try {
        const { q, type } = req.query;
        let query;
        let params;

        if (type === 'tag') {
            // 按标签搜索
            const tags = q.split(',').map(tag => tag.trim());
            const tagConditions = tags.map(() => 'tags LIKE ?').join(' OR ');
            params = tags.map(tag => `%${tag}%`);
            query = `SELECT * FROM notes WHERE ${tagConditions}`;
        } else {
            // 按内容搜索（默认）
            query = 'SELECT * FROM notes WHERE title LIKE ? OR content LIKE ?';
            params = [`%${q}%`, `%${q}%`];
        }

        const rows = await executeQuery(query, params);
        res.json(rows);
    } catch (error) {
        console.error('搜索笔记失败:', error);
        res.status(500).json({ error: '搜索失败' });
    }
});

// 获取单个笔记
app.get('/api/notes/:id', async (req, res) => {
    try {
        const [note] = await executeQuery(
            'SELECT * FROM notes WHERE id = ?',
            [req.params.id]
        );
        
        if (!note) {
            return res.status(404).json({ error: '笔记不存在' });
        }
        
        res.json(note);
    } catch (error) {
        console.error('获取笔记失败:', error);
        res.status(500).json({ error: '获取笔记失败' });
    }
});

// 创建笔记
app.post('/api/notes', async (req, res) => {
    try {
        const { title, content, tags } = req.body;
        
        if (!title || !content) {
            return res.status(400).json({ error: '标题和内容为必填项' });
        }
        
        const result = await executeQuery(
            'INSERT INTO notes (title, content, tags) VALUES (?, ?, ?)',
            [title, content, tags || null]
        );
        
        if (!result.insertId) {
            throw new Error('创建笔记失败');
        }
        
        const [newNote] = await executeQuery(
            'SELECT * FROM notes WHERE id = ?',
            [result.insertId]
        );
        
        if (!newNote) {
            throw new Error('获取新创建的笔记失败');
        }
        
        res.json({ message: '笔记创建成功', note: newNote });
    } catch (error) {
        console.error('创建笔记失败:', error);
        res.status(500).json({ error: '创建笔记失败' });
    }
});

// 更新笔记
app.put('/api/notes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, content, tags } = req.body;
        
        if (!title || !content) {
            return res.status(400).json({ error: '标题和内容不能为空' });
        }
        
        const success = await Note.update(id, { title, content, tags });
        
        if (success) {
            res.json({ message: '笔记更新成功' });
        } else {
            res.status(404).json({ error: '笔记不存在' });
        }
    } catch (error) {
        console.error('更新笔记失败:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

// 删除笔记
app.delete('/api/notes/:id', async (req, res) => {
    try {
        const result = await executeQuery(
            'DELETE FROM notes WHERE id = ?',
            [req.params.id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: '笔记不存在' });
        }
        
        res.json({ message: '笔记删除成功' });
    } catch (error) {
        console.error('删除笔记失败:', error);
        res.status(500).json({ error: '删除笔记失败' });
    }
});

// 添加图标上传路由
app.post('/api/upload-icon', upload.single('icon'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '没有上传文件' });
        }

        const iconUrl = `/icons/${req.file.filename}`;
        res.json({ iconUrl });
    } catch (error) {
        console.error('上传图标失败:', error);
        res.status(500).json({ error: '上传图标失败' });
    }
});

// 更新链接的favicon
app.put('/api/links/:id/favicon', async (req, res) => {
    try {
        const { id } = req.params;
        const { favicon } = req.body;

        const [result] = await pool.query(
            'UPDATE links SET favicon = ? WHERE id = ?',
            [favicon, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: '链接不存在' });
        }

        res.json({ message: 'Favicon更新成功' });
    } catch (error) {
        console.error('更新favicon失败:', error);
        res.status(500).json({ error: '更新favicon失败' });
    }
});

// 自动下载并保存网站图标
async function downloadSiteIcon(linkId) {
    try {
        console.log('\n[downloadSiteIcon] 开始处理, linkId:', linkId);
        // 1. 先获取链接信息
        const [links] = await pool.query(
            'SELECT id, title, url FROM links WHERE id = ?',
            [linkId]
        );

        if (links.length === 0) {
            throw new Error('未找到指定链接');
        }

        const siteUrl = links[0].url;
        console.log('[downloadSiteIcon] 网站URL:', siteUrl);
        
        // 2. 获取favicon
        console.log('[downloadSiteIcon] 开始获取favicon...');
        const iconUrl = await getFavicon(siteUrl);
        
        if (!iconUrl) {
            console.log('[downloadSiteIcon] 未获取到favicon');
            return null;
        }
        
        console.log('[downloadSiteIcon] 获取到favicon:', iconUrl);
        return iconUrl;
    } catch (error) {
        console.error('[downloadSiteIcon] 下载网站图标失败:', error);
        throw error;
    }
}

// 自动更新网站的favicon
app.post('/api/auto-update-favicon/:linkId', async (req, res) => {
    try {
        const linkId = req.params.linkId;
        console.log('\n[updateFavicon] 开始更新favicon, linkId:', linkId);

        // 1. 检查链接是否存在
        const [links] = await pool.query(
            'SELECT id, title, url FROM links WHERE id = ?',
            [linkId]
        );

        if (links.length === 0) {
            console.log('[updateFavicon] 未找到指定链接');
            return res.status(404).json({ error: '未找到指定链接' });
        }

        // 2. 下载并保存图标
        console.log('[updateFavicon] 开始下载图标...');
        const iconUrl = await downloadSiteIcon(linkId);

        if (!iconUrl) {
            console.log('[updateFavicon] 未能获取到新的favicon');
            return res.status(400).json({ error: '未能获取到新的favicon' });
        }

        // 3. 更新数据库中的favicon
        console.log('[updateFavicon] 更新数据库中的favicon:', iconUrl);
        await pool.query(
            'UPDATE links SET favicon = ? WHERE id = ?',
            [iconUrl, linkId]
        );

        console.log('[updateFavicon] 更新成功');
        res.json({ 
            message: 'favicon更新成功',
            iconUrl: iconUrl,
            linkId: linkId
        });
    } catch (error) {
        console.error('[updateFavicon] 自动更新图标失败:', error);
        res.status(500).json({ error: '自动更新图标失败' });
    }
});

// 更新笔记排序顺序
app.post('/api/notes/reorder', async (req, res) => {
    const { noteIds } = req.body;
    
    if (!Array.isArray(noteIds) || noteIds.length === 0) {
        return res.status(400).json({ error: '无效的笔记ID数组' });
    }

    try {
        // 开始事务
        await pool.query('START TRANSACTION');

        // 更新每个笔记的排序
        for (let i = 0; i < noteIds.length; i++) {
            const noteId = noteIds[i];
            const order = noteIds.length - i; // 倒序，最后一个是1
            await pool.query(
                'UPDATE notes SET sort_order = ? WHERE id = ?',
                [order, noteId]
            );
        }

        // 提交事务
        await pool.query('COMMIT');
        
        res.json({ message: '笔记顺序更新成功' });
    } catch (error) {
        // 如果出错，回滚事务
        await pool.query('ROLLBACK');
        console.error('更新笔记顺序失败:', error);
        res.status(500).json({ error: '更新笔记顺序失败' });
    }
});

// 获取所有笔记（带排序）
app.get('/api/notes', async (req, res) => {
    try {
        const sort = req.query.sort || 'desc'; // 默认按时间降序
        const orderBy = req.query.orderBy || 'created_at'; // 可以是 'created_at' 或 'sort_order'
        
        let query;
        if (orderBy === 'sort_order') {
            query = `SELECT * FROM notes ORDER BY sort_order ${sort === 'desc' ? 'DESC' : 'ASC'}`;
        } else {
            query = `SELECT * FROM notes ORDER BY created_at ${sort === 'desc' ? 'DESC' : 'ASC'}, id ${sort === 'desc' ? 'DESC' : 'ASC'}`;
        }
        
        const rows = await executeQuery(query);
        res.json(rows);
    } catch (error) {
        console.error('获取笔记失败:', error);
        res.status(500).json({ error: '获取笔记失败' });
    }
});

// 导出笔记
app.get('/api/notes/export', async (req, res) => {
    try {
        const rows = await executeQuery('SELECT * FROM notes ORDER BY sort_order DESC');
        res.json(rows);
    } catch (error) {
        console.error('导出笔记失败:', error);
        res.status(500).json({ error: '导出笔记失败' });
    }
}); 