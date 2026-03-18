const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');

const orgController = require('../controllers/org.controller');

const router = express.Router();

// Public: invitation accept flow (supports new-user acceptance)
router.post('/invitations/:token/accept', orgController.acceptInvitation);

router.use(authMiddleware);

router.post('/', orgController.createOrg);
router.get('/', orgController.getCurrentOrg);
router.delete('/', orgController.deleteOrg);
router.get('/email/status', orgController.emailStatus);
router.patch('/settings', orgDbMiddleware, orgController.updateSettings);
router.get('/members', orgDbMiddleware, orgController.listMembers);
router.post('/members/invite', orgDbMiddleware, orgController.inviteMember);
router.delete('/members/:memberId', orgDbMiddleware, orgController.removeMember);
router.get('/invitations', orgController.listInvitations);
router.get('/billing', orgController.billing);
router.get('/billing/plans', orgController.billingPlans);
router.post('/billing/coupon/validate', orgController.validateBillingCoupon);
router.post('/billing/checkout', orgController.billingCheckout);
router.get('/db-status', orgController.dbStatus);

module.exports = router;
