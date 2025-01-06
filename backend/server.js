const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const Link = require('./models/Link');
const app = express();

// 启用 CORS
app.use(cors());
app.use(express.json());

// 连接 MongoDB Atlas
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Connected to MongoDB');
  
  // 初始化默认数据
  Link.countDocuments().then(count => {
    if (count === 0) {
      const defaultLinks = [
        {
          category: "常用工具",
          title: "ChatGPT",
          url: "https://chat.openai.com",
          description: "AI 对话助手"
        },
        {
          category: "常用工具",
          title: "GitHub",
          url: "https://github.com",
          description: "代码托管平台"
        },
        {
          category: "学习资源",
          title: "哔哩哔哩",
          url: "https://www.bilibili.com",
          description: "视频学习平台"
        }
      ];
      
      Link.insertMany(defaultLinks)
        .then(() => console.log('Default links added'))
        .catch(err => console.error('Error adding default links:', err));
    }
  });
});

// API 路由
app.get('/api/links', async (req, res) => {
  try {
    const links = await Link.find();
    const groupedLinks = links.reduce((acc, link) => {
      if (!acc[link.category]) {
        acc[link.category] = [];
      }
      acc[link.category].push({
        title: link.title,
        url: link.url,
        description: link.description
      });
      return acc;
    }, {});
    res.json(groupedLinks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 添加新分类
app.post('/api/categories', async (req, res) => {
  try {
    const { category } = req.body;
    if (!category) {
      return res.status(400).json({ error: 'Missing category name' });
    }
    
    const existingCategory = await Link.findOne({ category });
    if (existingCategory) {
      return res.status(400).json({ error: 'Category already exists' });
    }
    
    // 创建一个空链接来创建新分类
    await Link.create({
      category,
      title: "示例链接",
      url: "https://example.com",
      description: "这是一个示例链接"
    });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 添加新链接
app.post('/api/links', async (req, res) => {
  try {
    const { category, link } = req.body;
    if (!category || !link) {
      return res.status(400).json({ error: 'Missing category or link' });
    }
    
    await Link.create({
      category,
      title: link.title,
      url: link.url,
      description: link.description
    });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除链接
app.delete('/api/links/:category/:index', async (req, res) => {
  try {
    const { category, index } = req.params;
    const links = await Link.find({ category });
    if (index >= 0 && index < links.length) {
      await Link.findByIdAndDelete(links[index]._id);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Link not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something broke!' });
});

module.exports = app; 