import { it, expect } from 'vitest';
import { recordsToDataset, datasetToRecords } from '../../src/data/records.js';

it('round trip keeps an empty rack\'s company and a blank device name', () => {
  const recs = [
    { build_name: '가산IDC', floorspace_name: '1A0101', company: '해원회사', rack_name: 'E', device_position: '', device_name: '' },
    { build_name: '가산IDC', floorspace_name: '1A0102', company: '누리텍', rack_name: 'R', device_position: '3U (1-3)', device_name: '' },
  ];
  const back = datasetToRecords(recordsToDataset(recs).json);
  expect(back).toEqual(recs);
});
