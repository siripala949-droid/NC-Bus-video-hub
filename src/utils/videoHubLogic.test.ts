import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidBlueprintId,
  isValidVideoCategory,
  isValidReactionType,
  computeNextReactionState,
  validateVideoUploadInput,
  filterVideosByCategoryAndQuery,
  buildDriveUrls,
  formatUploadNotificationMessage,
  formatFileSize,
} from './videoHubLogic';

test('isValidBlueprintId validates alphanumeric, underscore, and hyphen IDs up to 128 chars', () => {
  assert.equal(isValidBlueprintId('vid_123-abc'), true);
  assert.equal(isValidBlueprintId(''), false);
  assert.equal(isValidBlueprintId('invalid$id!'), false);
  assert.equal(isValidBlueprintId('a'.repeat(129)), false);
});

test('isValidVideoCategory validates strictly allowed categories', () => {
  assert.equal(isValidVideoCategory('Simulation'), true);
  assert.equal(isValidVideoCategory('Racing'), true);
  assert.equal(isValidVideoCategory('Documentary'), true);
  assert.equal(isValidVideoCategory('Gameplay'), true);
  assert.equal(isValidVideoCategory('InvalidCategory'), false);
});

test('isValidReactionType and computeNextReactionState handle create, update, and delete transitions', () => {
  assert.equal(isValidReactionType('like'), true);
  assert.equal(isValidReactionType('fire'), true);
  assert.equal(isValidReactionType('trophy'), true);
  assert.equal(isValidReactionType('angry'), false);

  // Adding a new reaction increments count
  const created = computeNextReactionState(null, 'like', 4);
  assert.deepEqual(created, {
    nextReaction: 'like',
    nextLikeCount: 5,
    operation: 'create',
  });

  // Switching reaction type keeps count unchanged and performs update
  const updated = computeNextReactionState('like', 'fire', 5);
  assert.deepEqual(updated, {
    nextReaction: 'fire',
    nextLikeCount: 5,
    operation: 'update',
  });

  // Clicking the active reaction removes it and decrements count
  const deleted = computeNextReactionState('fire', 'fire', 5);
  assert.deepEqual(deleted, {
    nextReaction: null,
    nextLikeCount: 4,
    operation: 'delete',
  });
});

test('validateVideoUploadInput enforces MP4 file, category, and blueprint length bounds', () => {
  const validFile = { name: 'kerala_bus_mod.mp4', type: 'video/mp4', size: 15_000_000 };

  const missingFile = validateVideoUploadInput('Bus Drift', 'No copyright clip', null, 'Racing');
  assert.equal(missingFile.valid, false);
  assert.match(missingFile.error || '', /MP4 video file/i);

  const invalidCategory = validateVideoUploadInput(
    'Bus Drift',
    'No copyright clip',
    validFile,
    'UnknownGenre'
  );
  assert.equal(invalidCategory.valid, false);
  assert.match(invalidCategory.error || '', /valid category/i);

  const validResult = validateVideoUploadInput(
    '  BUSSID Zedone Night Highway 60FPS  ',
    '  Free to use in gaming edits and reels without copyright strikes.  ',
    validFile,
    'Racing'
  );
  assert.equal(validResult.valid, true);
  assert.equal(validResult.sanitizedTitle, 'BUSSID Zedone Night Highway 60FPS');
  assert.equal(validResult.sanitizedCategory, 'Racing');
});

test('filterVideosByCategoryAndQuery filters accurately by category and search query', () => {
  const sampleVideos = [
    {
      title: 'Komban Bus Mountain Pass',
      description: 'Realistic ghat road run',
      uploaderName: 'DriverOne',
      category: 'Simulation',
    },
    {
      title: 'Highway Bus Drag Race',
      description: 'Top speed test',
      uploaderName: 'SpeedBus',
      category: 'Racing',
    },
  ];

  assert.equal(filterVideosByCategoryAndQuery(sampleVideos, 'All', '').length, 2);
  assert.equal(filterVideosByCategoryAndQuery(sampleVideos, 'Racing', '').length, 1);
  assert.equal(filterVideosByCategoryAndQuery(sampleVideos, 'Documentary', '').length, 0);
  assert.equal(
    filterVideosByCategoryAndQuery(sampleVideos, 'All', 'mountain').length,
    1
  );
});

test('buildDriveUrls constructs stream, download, and embed URLs within blueprint limits', () => {
  const urls = buildDriveUrls('1AbCdEfGhIjKlMnOpQrStUvWxYz');
  assert.equal(
    urls.downloadUrl,
    'https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQrStUvWxYz'
  );
  assert.equal(
    urls.embedPreviewUrl,
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/preview'
  );
});

test('formatUploadNotificationMessage formats follower notification within 300 chars', () => {
  const msg = formatUploadNotificationMessage('ApexBusGamer', 'Komban Dawood 4K Status');
  assert.equal(msg, 'ApexBusGamer just uploaded a new video: Komban Dawood 4K Status');
  assert.ok(msg.length <= 300);
});

test('formatFileSize formats bytes into human-readable units', () => {
  assert.equal(formatFileSize(500), '500 B');
  assert.equal(formatFileSize(2048), '2.0 KB');
  assert.equal(formatFileSize(10 * 1024 * 1024), '10.0 MB');
});
