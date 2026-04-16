const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const TicketFile = require('../models/TicketFile');
const { requirePermission } = require('../lib/roles');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/';
    // Create uploads directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: function (req, file, cb) {
    // Optional: Add file type validation
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|zip/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  }
});

// Upload single file for ticket
router.post(
  "/ticket/:id/upload/single",
  requirePermission(['issue::update']),
  upload.single("file"),
  async (req, res) => {
    try {
      console.log(req.file);
      console.log(req.body);

      if (!req.file) {
        return res.status(400).send({
          success: false,
          message: "No file uploaded"
        });
      }

      const uploadedFile = await TicketFile.create({
        ticketId: req.params.id,
        filename: req.file.originalname,
        path: req.file.path,
        mime: req.file.mimetype,
        size: req.file.size,
        encoding: req.file.encoding,
        userId: req.body.user,
      });

      console.log(uploadedFile);

      res.status(200).send({
        success: true,
        fileId: uploadedFile._id,
        message: "File uploaded successfully"
      });
    } catch (error) {
      console.error("Error uploading file:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Get all ticket attachments
router.get(
  "/ticket/:id/files",
  requirePermission(['issue::read']),
  async (req, res) => {
    try {
      const { id } = req.params;

      const files = await TicketFile.find({ ticketId: id })
        .populate('userId', 'name email')
        .select('filename mime size createdAt userId');

      res.status(200).send({
        success: true,
        files: files
      });
    } catch (error) {
      console.error("Error fetching ticket files:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Delete an attachment
router.delete(
  "/file/:fileId/delete",
  requirePermission(['issue::update']),
  async (req, res) => {
    try {
      const { fileId } = req.params;

      const file = await TicketFile.findById(fileId);
      if (!file) {
        return res.status(404).send({
          success: false,
          message: "File not found"
        });
      }

      // Delete the physical file
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }

      // Delete the database record
      await TicketFile.findByIdAndDelete(fileId);

      res.status(200).send({
        success: true,
        message: "File deleted successfully"
      });
    } catch (error) {
      console.error("Error deleting file:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Download an attachment
router.get(
  "/file/:fileId/download",
  requirePermission(['issue::read']),
  async (req, res) => {
    try {
      const { fileId } = req.params;

      const file = await TicketFile.findById(fileId);
      if (!file) {
        return res.status(404).send({
          success: false,
          message: "File not found"
        });
      }

      if (!fs.existsSync(file.path)) {
        return res.status(404).send({
          success: false,
          message: "File not found on server"
        });
      }

      // Set appropriate headers for download
      res.setHeader('Content-Type', file.mime);
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.setHeader('Content-Length', file.size);

      // Stream the file
      const fileStream = fs.createReadStream(file.path);
      fileStream.pipe(res);

      // Handle stream errors
      fileStream.on('error', (error) => {
        console.error("Error streaming file:", error);
        res.status(500).send({
          success: false,
          message: "Error downloading file"
        });
      });

    } catch (error) {
      console.error("Error downloading file:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Get file info (without downloading)
router.get(
  "/file/:fileId/info",
  requirePermission(['issue::read']),
  async (req, res) => {
    try {
      const { fileId } = req.params;

      const file = await TicketFile.findById(fileId)
        .populate('userId', 'name email')
        .select('filename mime size createdAt userId ticketId');

      if (!file) {
        return res.status(404).send({
          success: false,
          message: "File not found"
        });
      }

      res.status(200).send({
        success: true,
        file: file
      });
    } catch (error) {
      console.error("Error fetching file info:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

module.exports = router;
