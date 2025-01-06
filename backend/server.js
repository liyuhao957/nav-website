const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const Link = require('./models/Link');
const app = express();

// 连接 MongoDB Atlas
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Connected to MongoDB');
  
  // 初始化默认数据
  Link.countDocuments().then(count => {
    if (count === 0) {
      // 如果数据库为空，添加默认数据
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
}).catch(err => {
  console.error('MongoDB connection error:', err);
});

app.use(cors());
app.use(express.json());

// API 路由
app.get('/api/links', async (req, res) => {
  try {
    const links = await Link.find();
    // 将数据转换为原来的格式
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

app.post('/api/links', async (req, res) => {
  try {
    const { category, link } = req.body;
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

// 添加新分类
app.post('/api/categories', async (req, res) => {
  try {
    const { category } = req.body;
    if (!category) {
      throw new Error('Missing category name');
    }
    const existingCategory = await Link.findOne({ category });
    if (existingCategory) {
      throw new Error('Category already exists');
    }
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = app; 