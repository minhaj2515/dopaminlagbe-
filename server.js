const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const path = require('path');
const fs = require('fs'); 

ffmpeg.setFfmpegPath(ffmpegStatic);

const app = express();

const upload = multer({ 
    dest: 'uploads/'
}).fields([{ name: 'video' }, { name: 'music' }]);

const activeJobs = {}; 

app.use(express.static('public'));

app.post('/process-video', (req, res) => {
    upload(req, res, function (err) {
        if (err) {
            return res.status(500).send(`Upload error: ${err.message}`);
        }

        const videoFile = req.files['video'] ? req.files['video'][0] : null;
        if (!videoFile) return res.status(400).send('No video uploaded.');

        const videoPath = videoFile.path;
        const musicPath = req.files['music'] ? req.files['music'][0].path : null;
        
        const startTime = req.body.startTime || '00:00:00'; 
        const endTime = req.body.endTime;

        const jobId = Date.now().toString(); 
        const outputPath = `uploads/processed_${jobId}.mp4`;

        activeJobs[jobId] = { percent: 0, status: 'processing' };
        res.json({ jobId: jobId });

        let command = ffmpeg(videoPath);

        if (startTime !== '00:00:00') command.inputOptions([`-ss ${startTime}`]);
        if (endTime) command.inputOptions([`-to ${endTime}`]);

        command.input('overly.png')
            .input('logo.png')
            .input('overly.mov').inputOptions(['-stream_loop', '-1']); 

        // Start building our complex filter list
        let filterComplex = [
            '[0:v]eq=saturation=0.2[v_sat]',
            '[v_sat][1:v]overlay=0:0[v_ov1]',
            '[v_ov1][2:v]overlay=W-w-10:10[v_ov2]',
            '[v_ov2][3:v]overlay=0:0:shortest=1[outv]'
        ];

        let outputOptions = [
            '-map', '[outv]'
        ];

        // Apply Background Music Logic
        if (musicPath) {
            // 1. ADDED: -stream_loop -1 forces the uploaded music to loop infinitely
            command.input(musicPath).inputOptions(['-stream_loop', '-1']);
            
            // 2. Add audio mixing to our filter list
            filterComplex.push('[4:a]volume=-18dB[bgm]');
            filterComplex.push('[0:a][bgm]amix=inputs=2:duration=first[outa]');
            outputOptions.push('-map', '[outa]');
        } else {
            outputOptions.push('-map', '0:a?');
        }

        // Combine all video and audio filters into one single command
        outputOptions.unshift('-filter_complex', filterComplex.join(';'));

        command.outputOptions(outputOptions)
            .on('progress', (progress) => {
                if (progress.percent) {
                    activeJobs[jobId].percent = Math.max(0, Math.min(100, progress.percent.toFixed(1)));
                }
            })
            .on('end', () => {
                console.log(`Job ${jobId} finished!`);
                activeJobs[jobId] = { percent: 100, status: 'completed', downloadUrl: `/download?path=${path.basename(outputPath)}` };
                
                fs.unlink(videoPath, () => {});
                if (musicPath) fs.unlink(musicPath, () => {});
            })
            .on('error', (err) => {
                console.error('FFmpeg Error:', err.message);
                activeJobs[jobId] = { status: 'error', message: err.message };
                
                fs.unlink(videoPath, () => {});
                if (musicPath) fs.unlink(musicPath, () => {});
            })
            .save(outputPath);
    });
});

app.get('/progress/:jobId', (req, res) => {
    const job = activeJobs[req.params.jobId];
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
});

app.get('/download', (req, res) => {
    const filePath = path.join(__dirname, 'uploads', req.query.path);
    res.download(filePath, (err) => {
        if (!err) fs.unlink(filePath, () => {});
    });
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));