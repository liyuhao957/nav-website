const mysql = require('mysql2/promise');

class Note {
    static async update(id, { title, content, tags }) {
        const connection = await mysql.createConnection({
            host: process.env.MYSQL_HOST || '159.75.107.196',
            user: process.env.MYSQL_USER || 'root',
            password: process.env.MYSQL_PASSWORD || 'debezium',
            database: process.env.MYSQL_DATABASE || 'nav_website'
        });
        try {
            const [result] = await connection.execute(
                'UPDATE notes SET title = ?, content = ?, tags = ? WHERE id = ?',
                [title, content, tags, id]
            );
            return result.affectedRows > 0;
        } catch (error) {
            console.error('Error updating note:', error);
            throw error;
        } finally {
            await connection.end();
        }
    }
}

module.exports = Note; 