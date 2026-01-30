import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs-extra';
import { downloadVideo } from '../src/services/videoDownloader.js';
import { identifyMusicTracks } from '../src/services/musicIdentifier.js';

dotenv.config({ path: path.resolve(process.cwd(), 'backend/.env') });

async function run() {
  const url = 'https://f006.backblazeb2.com/file/filmash/videos/series/S242206_Fishing_For_Money/season_1/episode_1/1762795243775-Ep1.mp4';

  console.log('Starting download of segments for URL:', url);
  try {
    const result = await downloadVideo(url, (p) => console.log('Download progress:', p), { mode: 'segments' });
    console.log('Download result:', result.mode, 'segments:', result.segmentFiles.length);

    const segmentFilePaths = result.segmentFiles.map(s => s.file);
    console.log('Segment files:', segmentFilePaths);

    console.log('Calling ACRCloud identification on segments...');
    const tracks = await identifyMusicTracks(segmentFilePaths);

    console.log('Identification result:');
    console.log(JSON.stringify(tracks, null, 2));

    // Keep files list for inspection
    console.log('Saved files in downloads:');
    const files = await fs.readdir(path.resolve(process.cwd(), 'backend', 'downloads'));
    console.log(files.slice(-20));
  } catch (err) {
    console.error('Test failed:', err);
  }
}

run();
