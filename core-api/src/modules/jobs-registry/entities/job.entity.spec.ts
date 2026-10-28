import { getMetadataArgsStorage } from 'typeorm';
import { Job } from './job.entity';

describe('Job entity terminal timestamp metadata', () => {
  it.each([
    ['pickJobAt', 'timestamp'],
    ['workerId', 'varchar'],
    ['completedAt', 'timestamp'],
  ])('declares an explicit database type for %s', (propertyName, type) => {
    const column = getMetadataArgsStorage().columns.find(
      (metadata) =>
        metadata.target === Job && metadata.propertyName === propertyName,
    );

    expect(column?.options).toMatchObject({ type, nullable: true });
  });
});
