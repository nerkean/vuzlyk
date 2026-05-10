document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('embroidery-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    function resizeCanvas() {
        const container = canvas.parentElement;
        canvas.width = container.offsetWidth;
        canvas.height = container.offsetHeight;
        draw(); 
    }

    const stitchLength = 4;
    const stitchGap = 2;
    const totalSegmentLength = stitchLength + stitchGap;
    const treeColor = '#a07e5a';
    const lineWidth = 1.5;

    let branches = [];
    let currentBranchIndex = 0;
    let progress = 0;
    let animationFrameId;

    function setupBranches() {
        const width = canvas.width;
        const height = canvas.height;
        branches = [
            { start: { x: width / 2, y: height }, end: { x: width / 2, y: height * 0.75 } },
            { start: { x: width / 2, y: height * 0.75 }, end: { x: width * 0.4, y: height * 0.5 } },
            { start: { x: width / 2, y: height * 0.75 }, end: { x: width * 0.6, y: height * 0.5 } },
            { start: { x: width * 0.4, y: height * 0.5 }, end: { x: width * 0.3, y: height * 0.2 } },
            { start: { x: width * 0.4, y: height * 0.5 }, end: { x: width * 0.5, y: height * 0.3 } },
            { start: { x: width * 0.6, y: height * 0.5 }, end: { x: width * 0.7, y: height * 0.2 } },
            { start: { x: width * 0.6, y: height * 0.5 }, end: { x: width * 0.5, y: height * 0.3 } },
        ];
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = treeColor;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';

        for (let i = 0; i < currentBranchIndex; i++) {
            drawStitchedLine(branches[i].start, branches[i].end, 1);
        }

        if (currentBranchIndex < branches.length) {
            drawStitchedLine(branches[currentBranchIndex].start, branches[currentBranchIndex].end, progress);
        }
    }

    function drawStitchedLine(start, end, p) {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const numStitches = Math.floor(distance / totalSegmentLength);

        ctx.beginPath();
        for (let j = 0; j < numStitches * p; j++) {
            const startRatio = (j * totalSegmentLength) / distance;
            const endRatio = (j * totalSegmentLength + stitchLength) / distance;
            
            const x1 = start.x + dx * startRatio;
            const y1 = start.y + dy * startRatio;
            const x2 = start.x + dx * endRatio;
            const y2 = start.y + dy * endRatio;

            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
        }
        ctx.stroke();
    }

    function animate() {
        progress += 0.05; 
        if (progress >= 1) {
            progress = 0;
            currentBranchIndex++;
            if (currentBranchIndex >= branches.length) {
                cancelAnimationFrame(animationFrameId);
                return;
            }
        }
        draw();
        animationFrameId = requestAnimationFrame(animate);
    }

    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            resizeCanvas();
            setupBranches();
            setTimeout(() => animate(), 300);
            observer.disconnect();
        }
    }, { threshold: 0.1 });

    observer.observe(canvas);
    window.addEventListener('resize', () => {
        resizeCanvas();
        setupBranches();
    });
});