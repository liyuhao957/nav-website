const mongoose = require('mongoose');

const linkSchema = new mongoose.Schema({
    category: {
        type: String,
        required: true,
        trim: true
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    url: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    favicon: {
        type: String,
        trim: true
    },
    lastVisited: {
        type: Date,
        default: null
    },
    visitCount: {
        type: Number,
        default: 0
    },
    isValid: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// 添加索引以提高搜索性能
linkSchema.index({ title: 'text', description: 'text', category: 'text' });

// 更新updatedAt字段的中间件
linkSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('Link', linkSchema); 