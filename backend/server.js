const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const Link = require('./models/Link');
const app = express();

// 启用 CORS
app.use(cors());
app.use(express.json());

// MongoDB 连接配置
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000, // 超时时间设置为 5 秒
      socketTimeoutMS: 45000, // Socket 超时设置为 45 秒
    });
    console.log('MongoDB connected successfully');

    // 初始化默认数据
    const count = await Link.countDocuments();
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
      await Link.insertMany(defaultLinks);
      console.log('Default links added');
    }
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

// 连接数据库
connectDB();

// API 路由
app.get('/api/links', async (req, res) => {
  try {
    const links = await Link.find().maxTimeMS(5000); // 设置查询超时
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
    console.error('Error fetching links:', error);
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
    
    const existingCategory = await Link.findOne({ category }).maxTimeMS(5000);
    if (existingCategory) {
      return res.status(400).json({ error: 'Category already exists' });
    }
    
    await Link.create({
      category,
      title: "示例链接",
      url: "https://example.com",
      description: "这是一个示例链接"
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error creating category:', error);
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
    console.error('Error adding link:', error);
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

// 重命名分类
app.put('/api/categories/:oldName', async (req, res) => {
  try {
    const { oldName } = req.params;
    const { newName } = req.body;
    
    if (!newName) {
      return res.status(400).json({ error: '新分类名称不能为空' });
    }

    // 检查新名称是否已存在
    const existingCategory = await Link.findOne({ category: newName });
    if (existingCategory) {
      return res.status(400).json({ error: '该分类名称已存在' });
    }

    // 更新所有该分类下的链接
    const result = await Link.updateMany(
      { category: oldName },
      { $set: { category: newName } }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({ error: '分类不存在' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error renaming category:', error);
    res.status(500).json({ error: error.message });
  }
});

// 删除分类
app.delete('/api/categories/:category', async (req, res) => {
  try {
    const { category } = req.params;
    
    // 删除该分类下的所有链接
    const result = await Link.deleteMany({ category });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: '分类不存在' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: error.message });
  }
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something broke!' });
});

module.exports = app; 