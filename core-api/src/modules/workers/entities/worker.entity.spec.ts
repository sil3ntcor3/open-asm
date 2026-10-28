import { getMetadataArgsStorage } from 'typeorm';
import { WorkerInstance } from './worker.entity';

describe('WorkerInstance scanner status columns', () => {
  it('declares nullable scanner strings as PostgreSQL varchar columns', () => {
    const scannerStringColumns = new Set([
      'nucleiEngineVersion',
      'nucleiTemplateVersion',
      'nucleiTemplateSource',
      'nucleiTemplateStatus',
    ]);
    const columns = getMetadataArgsStorage().columns.filter(
      (column) =>
        column.target === WorkerInstance &&
        scannerStringColumns.has(column.propertyName),
    );

    expect(columns).toHaveLength(scannerStringColumns.size);
    for (const column of columns) {
      expect(column.options).toMatchObject({
        type: 'varchar',
        nullable: true,
      });
    }
  });
});
