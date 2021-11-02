<?php

namespace daos;

trait CommonSqlDatabase {
    public function exec($cmds, $args = null) {
        return $this->connection->exec($cmds, $args);
    }

    public function quote($value, $type = \PDO::PARAM_STR) {
        return $this->connection->quote($value, $type);
    }

    /**
     * Begin SQL transaction
     *
     * @return bool
     */
    public function begin() {
        return $this->connection->begin();
    }

    /**
     * Rollback SQL transaction
     *
     * @return bool
     */
    public function rollback() {
        return $this->connection->rollback();
    }

    /**
     * Commit SQL transaction
     *
     * @return bool
     */
    public function commit() {
        return $this->connection->commit();
    }

    public function getSchemaVersion() {
        $version = @$this->exec('SELECT version FROM ' . $this->configuration->dbPrefix . 'version ORDER BY version DESC LIMIT 1');

        return (int) $version[0]['version'];
    }

    /**
     * Insert raw table data into given table.
     *
     * @param string $table target database table
     * @param string[] $fields column names
     * @param array[] $data rows to insert
     */
    public function insertRaw($table, array $fields, array $data) {
        $fieldsSql = implode(', ', $fields);
        $valuesSql = implode(', ', array_map(function($field) {
            return ":$field";
        }, $fields));
        $values = [];
        foreach ($fields as $field) {
            $values[":$field"] = $data[$field];
        }

        $this->exec("insert into $table($fieldsSql) values($valuesSql)", $values);
    }
}
