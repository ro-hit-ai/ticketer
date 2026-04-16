const express = require('express');
const router = express.Router();
const TimeTracking = require('../models/TimeTracking');
const { requirePermission } = require('../lib/roles');

// Create a new entry
router.post('/new', requirePermission(['time_entry::create']), async (req, res) => {
  try {
    const { time, ticket, title, user } = req.body;
    console.log(req.body);

    const timeEntry = new TimeTracking({
      time: Number(time),
      title,
      userId: user,
      ticketId: ticket
    });

    await timeEntry.save();

    res.send({
      success: true
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({
      success: false,
      error: 'Failed to create time entry'
    });
  }
});

// Get all entries
router.get('/', requirePermission(['time_entry::read']), async (req, res) => {
  try {
    const timeEntries = await TimeTracking.find()
      .populate('userId', 'name email') // Assuming you want user details
      .populate('ticketId', 'ticketNumber title'); // Assuming you want ticket details
    
    res.send({
      success: true,
      data: timeEntries
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({
      success: false,
      error: 'Failed to fetch time entries'
    });
  }
});

// Delete an entry
router.delete('/:id', requirePermission(['time_entry::delete']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const deletedEntry = await TimeTracking.findByIdAndDelete(id);
    
    if (!deletedEntry) {
      return res.status(404).send({
        success: false,
        error: 'Time entry not found'
      });
    }
    
    res.send({
      success: true,
      message: 'Time entry deleted successfully'
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({
      success: false,
      error: 'Failed to delete time entry'
    });
  }
});

module.exports = router;
