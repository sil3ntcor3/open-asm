import { getMetadataArgsStorage } from 'typeorm';
import { Target } from './target.entity';

describe('Target entity metadata', () => {
  it('declares jobId as a varchar column', () => {
    const column = getMetadataArgsStorage().columns.find(
      ({ propertyName, target }) =>
        target === Target && propertyName === 'jobId',
    );

    expect(column?.options.type).toBe('varchar');
  });
});
