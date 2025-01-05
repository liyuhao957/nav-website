const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

// 添加请求日志中间件
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    next();
});

app.use(cors());
app.use(express.json());

// 内存存储
let links = {
    "常用工具": [
        { title: "ChatGPT", url: "https://chat.openai.com", description: "AI 对话助手" },
        { title: "GitHub", url: "https://github.com", description: "代码托管平台" }
    ],
    "学习资源": [
        { title: "哔哩哔哩", url: "https://www.bilibili.com", description: "视频学习平台" }
    ]
};

// API 路由
app.get('/api/links', (req, res) => {
    res.json(links);
});

// 获取所有分类
app.get('/api/categories', (req, res) => {
    res.json(Object.keys(links));
});

// 添加新分类
app.post('/api/categories', (req, res) => {
    try {
        const { category } = req.body;
        if (!category) {
            throw new Error('Missing category name');
        }
        if (links[category]) {
            throw new Error('Category already exists');
        }
        links[category] = [];
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// 重命名分类
app.put('/api/categories/:oldName', (req, res) => {
    try {
        const { oldName } = req.params;
        const { newName } = req.body;
        
        if (!newName) {
            throw new Error('Missing new category name');
        }
        if (!links[oldName]) {
            throw new Error('Category not found');
        }
        if (links[newName]) {
            throw new Error('New category name already exists');
        }
        
        links[newName] = links[oldName];
        delete links[oldName];
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// 删除分类
app.delete('/api/categories/:category', (req, res) => {
    try {
        const { category } = req.params;
        if (!links[category]) {
            throw new Error('Category not found');
        }
        delete links[category];
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/links', (req, res) => {
    try {
        const { category, link } = req.body;
        if (!category || !link) {
            throw new Error('Missing category or link');
        }
        
        if (!links[category]) {
            links[category] = [];
        }
        links[category].push(link);
        res.json({ success: true });
    } catch (error) {
        console.error('Error in POST /api/links:', error);
        res.status(500).json({ 
            error: error.message,
            stack: error.stack
        });
    }
});

app.delete('/api/links/:category/:index', (req, res) => {
    try {
        const { category, index } = req.params;
        links[category].splice(parseInt(index), 1);
        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 默认路由
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error('Global error handler:');
    console.error(err);
    res.status(500).json({ 
        error: 'Something broke!',
        message: err.message,
        stack: err.stack
    });
});

module.exports = app; 