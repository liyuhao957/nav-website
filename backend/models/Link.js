const mysql = require('mysql2/promise');

class Link {
    static async update(id, { title, url, description, favicon }) {
        const connection = await mysql.createConnection({
            host: process.env.MYSQL_HOST || '159.75.107.196',
            user: process.env.MYSQL_USER || 'root',
            password: process.env.MYSQL_PASSWORD || 'debezium',
            database: process.env.MYSQL_DATABASE || 'nav_website'
        });
        try {
            const [result] = await connection.execute(
                'UPDATE links SET title = ?, url = ?, description = ?, favicon = ? WHERE id = ?',
                [title, url, description, favicon, id]
            );
            return result.affectedRows > 0;
        } catch (error) {
            console.error('Error updating link:', error);
            throw error;
        } finally {
            await connection.end();
        }
    }
}

module.exports = Link; 