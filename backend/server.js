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
    console.log('GET /api/links');
    res.json(links);
});

app.post('/api/links', (req, res) => {
    console.log('POST /api/links');
    console.log('Request body:', req.body);
    try {
        const { category, link } = req.body;
        console.log('Category:', category);
        console.log('Link:', link);
        
        if (!category || !link) {
            throw new Error('Missing category or link');
        }
        
        if (!links[category]) {
            links[category] = [];
        }
        links[category].push(link);
        console.log('Updated links:', links);
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

// 导出 app 而不是启动服务器
module.exports = app; 