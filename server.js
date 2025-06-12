const express = require('express');
const mongoose = require('mongoose');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs').promises;
const path = require('path');
const app = express();
const port = 3000;
const cors = require('cors');

app.use(cors({
  origin: '*', // Allow requests from your frontend origin
  methods: ['GET', 'POST', 'PUT', 'DELETE'], // Specify allowed methods
  allowedHeaders: ['Content-Type'], // Specify allowed headers
}));

app.use(express.json());

// MongoDB connection
// mongoose.connect('mongodb+srv://pranjal-wmpsc:9wrSlB9usu6xq0Ht@wmpsc-mongo.jhgdntu.mongodb.net/kbl-database?retryWrites=true&w=majority&appName=wmpsc-mongo', { useNewUrlParser: true, useUnifiedTopology: true })
//   .then(() => console.log('Connected to MongoDB'))
//   .catch(err => console.error('MongoDB connection error:', err));

  // MongoDB connection caching
let cachedDb = null;
async function connectToDatabase() {
  if (cachedDb && cachedDb.connection.readyState === 1) {
    console.log('Using cached MongoDB connection');
    return cachedDb;
  }
  try {
    const db = await mongoose.connect('mongodb+srv://pranjal-wmpsc:9wrSlB9usu6xq0Ht@wmpsc-mongo.jhgdntu.mongodb.net/kbl-database?retryWrites=true&w=majority&appName=wmpsc-mongo', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000 // Reduce timeout for faster error
    });
    console.log('MongoDB connected');
    cachedDb = db;
    return db;
  } catch (err) {
    console.error('MongoDB connection error:', err);
    throw err;
  }
}

// Connect before handling requests
app.use(async (req, res, next) => {
  await connectToDatabase();
  next();
});
// Candidate Schema
const candidateSchema = new mongoose.Schema({
  name: String,
  candidateId: String,
  aadhar: String,
  mobile: String,  
  email: String,
  dateOfBirth:String,
  gender:String,
  category:String,
  assessments: [{
    batchId: String,
    schemeName: String,
    result: String,
    trainingPartner:{   
      status: String,
      tpId : String,
      tpName: String,
      centerName: String,
      centerAddress:String,
      enrollmentDate: String
    },
    assessmentAgency: {
      name: String,
      assessorName: String,
    },
    answers: [{
      nosCode: String,
      questionType: String,
      marksObtained: Number,
      totalMarks: Number,
      selectedOption: String,
      isCorrect: Boolean,
    }],
    nosWiseMarks: [{
      nosCode: String,
      theory: {
        totalMarks: Number,
        marksObtained: Number,
        percentage: Number,
      },
      practical: {
        totalMarks: Number,
        marksObtained: Number,
        percentage: Number,
      },
      total: {
        totalMarks: Number,
        marksObtained: Number,
        percentage: Number,
      },
    }],
    status: String,
    completedAt: Date,
  }],
});

// Use correct collection name: candidatekbls
const Candidate = mongoose.model('Candidatekbl', candidateSchema, 'candidatekbls');

// Weightage configuration
const weightage = {
  mbjr: {
    modules: [
      { name: 'Module 1', nosCode: 'Module 1', theory: 15, viva: 5, practical: 0, project: 0 },
      { name: 'Module 2', nosCode: 'Module 2', theory: 15, viva: 5, practical: 30, project: 0 },
      { name: 'Module 3', nosCode: 'Module 3', theory: 15, viva: 5, practical: 30, project: 0 },
      { name: 'Module 4', nosCode: 'Module 4', theory: 15, viva: 5, practical: 30, project: 0 },
      { name: 'Module 5', nosCode: 'Module 5', theory: 15, viva: 5, practical: 30, project: 0 },
    ],
    passThreshold: 60,
  },
  pg: {
    modules: [
      { name: 'PSC/N0130', nosCode: 'PSC/N0130', theory: 15, viva: 5, practical: 0, project: 0 },
      { name: 'PSC/N0131', nosCode: 'PSC/N0131', theory: 15, viva: 5, practical: 30 },
      { name: 'PSC/N0132', nosCode: 'PSC/N0132', theory: 15, viva: 5, practical: 30 },
      { name: 'PSC/N0133', nosCode: 'PSC/N0133', theory: 15, viva: 5, practical: 30 },
      { name: 'PSC/N0142', nosCode: 'PSC/N0142', theory: 15, viva: 5, practical: 30 },
      { name: 'PSC/N0136', nosCode: 'PSC/N0136', theory: 15, viva: 5, practical: 20 },
      { name: 'DGT/VSQ/N0102', nosCode: 'DGT/VSQ/N0102', theory: 15, viva: 5, practical: 30 },
    ],
    passThreshold: 60,
  },
  sewage_treatment: {
    modules: [
      { name: 'PSC/N0604', nosCode: 'PSC/N0604', theory: 30, viva: 10, practical: 60, project: 0 },
      { name: 'PSC/N0601', nosCode: 'PSC/N0601', theory: 30, viva: 10, practical: 60, project: 0 },
      { name: 'PSC/N0606', nosCode: 'PSC/N0606', theory: 30, viva: 10, practical: 60, project: 0 },
      { name: 'PSC/N0603', nosCode: 'PSC/N0603', theory: 30, viva: 10, practical: 60, project: 0 },
      { name: 'PSC/N0602', nosCode: 'PSC/N0602', theory: 30, viva: 10, practical: 60, project: 0 },
      { name: 'DGT/VSQ/N0101', nosCode: 'DGT/VSQ/N0101', theory: 20, viva: 0, practical: 30, project: 0 },
    ],
    passThreshold: 80,
  },
};

// API to detect data format
const detectFormat = (assessment) => {
  const hasQuestionType = assessment.answers && assessment.answers.some(answer => answer.questionType);
  return hasQuestionType ? 'new' : 'none';
};

// API to generate CSV result
app.get('/api/results/:batchId', async (req, res) => {
  try {
    const batchId = req.params.batchId;
    console.log(`Processing request for batchId: ${batchId}`);

    // Fetch all candidates for the batch
    const candidates = await Candidate.find({ 'assessments.batchId': batchId });
    console.log(`Retrieved ${candidates.length} candidates for batch ${batchId}`);

    if (candidates.length === 0) {
      console.warn('No candidates found for batch. Returning empty CSV.');
      return res.status(404).send('No candidates found');
    }

    // Determine schemeName
    const schemeName = candidates[0]?.assessments.find(a => a.batchId === batchId)?.schemeName || 'mbjr';
    console.log(`Scheme name: ${schemeName}`);

    // Validate schemeName
    if (!weightage[schemeName]) {
      console.error(`Invalid schemeName: ${schemeName}`);
      return res.status(400).send(`Invalid schemeName: ${schemeName}`);
    }

    // Use only predefined modules for the scheme
    let modules = weightage[schemeName].modules || [];
    console.log('Modules:', modules.map(m => `${m.name} (${m.nosCode})`));

    if (modules.length === 0) {
      console.error('No modules defined for scheme. Cannot generate CSV.');
      return res.status(500).send('Internal Server Error: No modules defined');
    }

    // Calculate total maximum marks
    let maxTotalTheory = 0;
    let maxTotalViva = 0;
    let maxTotalPractical = 0;
    modules.forEach(module => {
      maxTotalTheory += module.theory;
      maxTotalViva += module.viva;
      maxTotalPractical += module.practical;
    });
    const maxTotalMarks = maxTotalTheory + maxTotalViva + maxTotalPractical;
    console.log(`Max marks: Theory=${maxTotalTheory}, Viva=${maxTotalViva}, Practical=${maxTotalPractical}, Total=${maxTotalMarks}`);

    // Prepare CSV header configuration
    const csvHeader = [
      { id: 'S No.', title: 'S No.' },
      { id: 'STUDENT UNIQUE ID', title: 'STUDENT UNIQUE ID' },
      { id: 'Name of the Candidate', title: 'Name of the Candidate' },
    ];

    modules.forEach((module, index) => {
      const moduleNum = index + 1;
      const headerPrefix = schemeName === 'mbjr' ? `Module ${moduleNum}` : module.nosCode;
      csvHeader.push(
        { id: `Module ${moduleNum} Theory`, title: `${headerPrefix} Theory (${module.theory})` },
        { id: `Module ${moduleNum} Project`, title: `${headerPrefix} Project (${module.project})` },
        { id: `Module ${moduleNum} Viva`, title: `${headerPrefix} Viva (${module.viva})` },
        { id: `Module ${moduleNum} Practical`, title: `${headerPrefix} Practical (${module.practical})` }
      );
    });

    csvHeader.push(
      { id: 'Total Theory', title: `Total Theory (${maxTotalTheory})` },
      { id: 'Total Project', title: `Total Project (0)` },
      { id: 'Total Viva', title: `Total Viva (${maxTotalViva})` },
      { id: 'Total Practical', title: `Total Practical (${maxTotalPractical})` },
      { id: 'Total Marks', title: `Total Marks (${maxTotalMarks})` },
      { id: 'Percentage (100)', title: 'Percentage (100)' },
      { id: 'Final Result', title: 'Final Result' }
    );
    console.log('CSV headers prepared:', csvHeader.map(h => h.title));

    // Prepare CSV data
    const csvData = [];
    let serialNo = 1;

    for (const candidate of candidates) {
      const assessment = candidate.assessments.find(a => a.batchId === batchId);
      console.log(`Processing candidate: ${candidate.name} (ID: ${candidate.candidateId})`);

      const row = {
        'S No.': serialNo++,
        'STUDENT UNIQUE ID': candidate.candidateId,
        'Name of the Candidate': candidate.name,
      };

      let totalTheory = 0;
      let totalViva = 0;
      let totalPractical = 0;

      if (assessment && assessment.status === 'completed' && assessment.answers && Array.isArray(assessment.answers)) {
        console.log(`Candidate ${candidate.name} has completed assessment`);

        // Initialize marks for each module
        const moduleMarks = {};
        modules.forEach((module, index) => {
          moduleMarks[index + 1] = { theory: 0, viva: 0, practical: 0 };
        });

        const format = detectFormat(assessment);
        console.log(`Data format for ${candidate.name}: ${format}`);

        if (format === 'new') {
          // Process answers (new format)
          console.log(`Processing new format for ${candidate.name}`);
          const rawMarks = {};
          modules.forEach((module, index) => {
            rawMarks[module.nosCode] = { theory: 0, viva: 0, practical: 0, theoryTotalMarks: 0, vivaTotalMarks: 0, practicalTotalMarks: 0 };
          });

          assessment.answers.forEach(answer => {
            if (!answer.nosCode || !answer.questionType || typeof answer.marksObtained !== 'number' || answer.marksObtained < 0) {
              console.warn(`Invalid answer data for candidate ${candidate.name}:`, answer);
              return;
            }
            const module = modules.find(m => m.nosCode === answer.nosCode);
            if (!module) {
              console.warn(`NOS code ${answer.nosCode} not found in modules for candidate ${candidate.name}`);
              return;
            }
            const nosCode = answer.nosCode;
            if (answer.questionType === 'theory') {
              rawMarks[nosCode].theory += answer.marksObtained;
              rawMarks[nosCode].theoryTotalMarks = Math.max(rawMarks[nosCode].theoryTotalMarks, answer.totalMarks || 0);
            } else if (answer.questionType === 'viva') {
              rawMarks[nosCode].viva += answer.marksObtained;
              rawMarks[nosCode].vivaTotalMarks = Math.max(rawMarks[nosCode].vivaTotalMarks, answer.totalMarks || 0);
            } else if (answer.questionType === 'practical') {
              rawMarks[nosCode].practical += answer.marksObtained;
              rawMarks[nosCode].practicalTotalMarks = Math.max(rawMarks[nosCode].practicalTotalMarks, answer.totalMarks || 0);
            } else {
              console.warn(`Unknown questionType ${answer.questionType} for candidate ${candidate.name}`);
            }
          });

          modules.forEach((module, index) => {
            const moduleNum = index + 1;
            const moduleWeight = module;
            const nosCode = module.nosCode;
            const raw = rawMarks[nosCode];

            let theoryMarks = 0;
            if (raw.theory > 0 && raw.theoryTotalMarks > 0) {
              theoryMarks = Math.min((raw.theory / raw.theoryTotalMarks) * moduleWeight.theory, moduleWeight.theory);
              console.log(`Candidate ${candidate.name}, ${nosCode} theory: raw=${raw.theory}, totalMarks=${raw.theoryTotalMarks}, theoryMarks=${theoryMarks.toFixed(2)}`);
            }

            let vivaMarks = 0;
            if (raw.viva > 0 && raw.vivaTotalMarks > 0) {
              vivaMarks = Math.min((raw.viva / raw.vivaTotalMarks) * moduleWeight.viva, moduleWeight.viva);
              console.log(`Candidate ${candidate.name}, ${nosCode} viva: raw=${raw.viva}, totalMarks=${raw.vivaTotalMarks}, vivaMarks=${vivaMarks.toFixed(2)}`);
            }

            let practicalMarks = 0;
            if (raw.practical > 0 && raw.practicalTotalMarks > 0) {
              practicalMarks = Math.min((raw.practical / raw.practicalTotalMarks) * moduleWeight.practical, moduleWeight.practical);
              console.log(`Candidate ${candidate.name}, ${nosCode} practical: raw=${raw.practical}, totalMarks=${raw.practicalTotalMarks}, practicalMarks=${practicalMarks.toFixed(2)}`);
            }

            moduleMarks[moduleNum].theory = theoryMarks;
            moduleMarks[moduleNum].viva = vivaMarks;
            moduleMarks[moduleNum].practical = practicalMarks;

            totalTheory += theoryMarks;
            totalViva += vivaMarks;
            totalPractical += practicalMarks;
          });
        } else {
          console.warn(`No valid new format data for candidate ${candidate.name}`);
          modules.forEach((module, index) => {
            const moduleNum = index + 1;
            moduleMarks[moduleNum].theory = 0;
            moduleMarks[moduleNum].viva = 0;
            moduleMarks[moduleNum].practical = 0;
          });
        }

        // Populate module marks
        modules.forEach((module, index) => {
          const moduleNum = index + 1;
          row[`Module ${moduleNum} Theory`] = moduleMarks[moduleNum].theory.toFixed(2);
          row[`Module ${moduleNum} Project`] = 0;
          row[`Module ${moduleNum} Viva`] = moduleMarks[moduleNum].viva.toFixed(2);
          row[`Module ${moduleNum} Practical`] = moduleMarks[moduleNum].practical.toFixed(2);
        });

        // Calculate totals
        const totalMarks = totalTheory + totalViva + totalPractical;
        const percentage = maxTotalMarks > 0 ? Math.min(((totalMarks / maxTotalMarks) * 100), 100).toFixed(2) : 0;
        row['Total Theory'] = totalTheory.toFixed(2);
        row['Total Project'] = 0;
        row['Total Viva'] = totalViva.toFixed(2);
        row['Total Practical'] = totalPractical.toFixed(2);
        row['Total Marks'] = totalMarks.toFixed(2);
        row['Percentage (100)'] = percentage;
        row['Final Result'] = percentage >= weightage[schemeName].passThreshold ? 'PASS' : 'FAIL';
        console.log(`Candidate ${candidate.name} totals: Theory=${totalTheory.toFixed(2)}, Viva=${totalViva.toFixed(2)}, Practical=${totalPractical.toFixed(2)}, Total=${totalMarks.toFixed(2)}, Percentage=${percentage}%`);
      } else {
        console.log(`Candidate ${candidate.name} has no completed assessment or answers`);
        modules.forEach((module, index) => {
          const moduleNum = index + 1;
          row[`Module ${moduleNum} Theory`] = 0;
          row[`Module ${moduleNum} Project`] = 0;
          row[`Module ${moduleNum} Viva`] = 0;
          row[`Module ${moduleNum} Practical`] = 0;
        });
        row['Total Theory'] = 0;
        row['Total Project'] = 0;
        row['Total Viva'] = 0;
        row['Total Practical'] = 0;
        row['Total Marks'] = 0;
        row['Percentage (100)'] = 0;
        row['Final Result'] = 'Assessment Not Completed';
      }

      csvData.push(row);
    }

    console.log(`Prepared ${csvData.length} rows for CSV`);

    // Define CSV writer
    const csvFilePath = path.join(__dirname, `result_sheet_${batchId}.csv`);
    console.log(`CSV file path: ${csvFilePath}`);
    const csvWriter = createCsvWriter({
      path: csvFilePath,
      header: csvHeader,
    });

    // Write CSV header
    const header = [
      'RESULT SHEET',
      `Name of Assessing Body: WMPSC Assessor`,
      `Name of Assessor: Rohit Shah`,
      `Scheme Name: ${schemeName}`,
      `Assessment Date: ${new Date().toLocaleDateString()}`,
      `No. of Candidates: ${csvData.length}`,
      '',
      `QP Code & Name: ${schemeName.toUpperCase()}`,
      '',
    ];
    console.log('CSV file header:', header);

    // Write CSV file
    try {
      await csvWriter.writeRecords(csvData);
      await fs.writeFile(csvFilePath, header.join('\n') + '\n' + await fs.readFile(csvFilePath, 'utf8'));
      console.log(`CSV file written: ${csvFilePath}`);
    } catch (writeError) {
      console.error('Error writing CSV file:', writeError);
      return res.status(500).send('Internal Server Error: Failed to write CSV file');
    }

    // Send the file
    res.download(csvFilePath, `result_sheet_${batchId}.csv`, err => {
      if (err) {
        console.error('Error sending CSV file:', err);
        res.status(500).send('Internal Server Error: Failed to send CSV file');
      } else {
        console.log('CSV file sent successfully');
      }
    });
  } catch (error) {
    console.error('Error generating CSV:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/api/candidates', async (req, res) => {
  try {
    console.log('Received Request Body:', req.body);

    // Check if candidateId/aadhar already exists
    const existingCandidate = await Candidate.findOne({ candidateId: req.body.candidateId });
    if (existingCandidate) {
      console.log('Existing Candidate Found:', existingCandidate);
      return res.status(400).json({
        error: 'Duplicate candidate ID',
        message: `Aadhar/Candidate ID "${req.body.candidateId}" already exists in the database.`,
      });
    }

    const candidate = new Candidate(req.body);
    await candidate.save();
    console.log('Saved Candidate:', candidate);
    res.status(201).json({ message: 'Candidate saved' });
  } catch (err) {
    console.error('Error saving candidate:', err);
    if (err.code === 11000 && err.keyPattern && err.keyPattern.candidateId) {
      res.status(400).json({
        error: 'Duplicate candidate ID',
        message: `Aadhar/Candidate ID "${req.body.candidateId}" already exists in the database.`,
      });
    } else {
      res.status(500).json({
        error: 'Server error',
        message: `Failed to save candidate data: ${err.message}`,
      });
    }
  }
});

// Start server
module.exports = app;