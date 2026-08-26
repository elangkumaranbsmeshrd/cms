/* ==========================================================================
   MESHRD CMS PROTOTYPE — DATA LAYER
   Screen registry + mock data, extracted from the 14 module .md specs.
   Every screen carries `ref` pointing at the spec section it came from.
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------- ROLES (RBAC Module 14 §4.1) ---------------- */
  const ROLES = {
    superadmin: { name: 'Super Admin', who: 'Ravi Shankar',   init: 'RS', email: 'ravi.shankar@meshrd.in',   color: 'var(--danger)',  scope: 'Unrestricted — every screen, every filter, unscoped' },
    accountant: { name: 'Accountant',  who: 'Nisha Kulkarni', init: 'NK', email: 'nisha.k@meshrd.in',        color: 'var(--success)', scope: 'Finance modules, company-wide scope' },
    hr:         { name: 'HR',          who: 'Fatima Sheikh',  init: 'FS', email: 'fatima.sheikh@meshrd.in',  color: 'var(--info)',    scope: 'People modules, no financial figures' },
    manager:    { name: 'Manager',     who: 'Vikram Iyer',    init: 'VI', email: 'vikram.iyer@meshrd.in',    color: 'var(--warning)', scope: 'Own records + 5 direct reports (Team scope)' },
    employee:   { name: 'Employee',    who: 'Arun Menon',     init: 'AM', email: 'arun.menon@meshrd.in',     color: 'var(--accent)',  scope: 'Own records only (Own scope)' }
  };
  const ALL = ['superadmin', 'manager', 'accountant', 'hr', 'employee'];

  /* ---------------- STATUS → BADGE CLASS ---------------- */
  const BADGE = {
    // generic
    'Active': 'b-ok', 'Inactive': 'b-neutral', 'Draft': 'b-neutral', 'Pending': 'b-warn',
    'Approved': 'b-ok', 'Rejected': 'b-danger', 'Cancelled': 'b-neutral', 'Completed': 'b-ok',
    'Locked': 'b-danger', 'Open': 'b-warn', 'Closed': 'b-neutral', 'Verified': 'b-ok',
    'Pending Verification': 'b-warn', 'Submitted': 'b-info', 'Yes': 'b-ok', 'No': 'b-neutral',
    // employee
    'On Notice': 'b-warn', 'Exited': 'b-neutral', 'In Progress': 'b-info', 'Not Started': 'b-neutral',
    // ticket
    'Resolved': 'b-ok', 'Urgent': 'b-danger', 'High': 'b-warn', 'Medium': 'b-info', 'Low': 'b-neutral',
    'Unassigned': 'b-outline',
    // asset
    'In Use': 'b-ok', 'In Store': 'b-info', 'Under Repair': 'b-warn', 'Retired-Disposed': 'b-neutral',
    'Overdue': 'b-danger', 'Upcoming': 'b-info',
    // invoice / bill
    'Sent': 'b-info', 'Part-Paid': 'b-warn', 'Paid': 'b-ok', 'Unpaid': 'b-danger',
    'Pending Approval': 'b-warn', 'Reimbursed': 'b-ok', 'Processed': 'b-ok', 'Reissued': 'b-purple',
    // opportunity / project
    'Prospecting': 'b-neutral', 'Qualifying': 'b-info', 'Proposal': 'b-warn', 'Won': 'b-ok', 'Lost': 'b-danger',
    'Prospect': 'b-info', 'On Hold': 'b-warn', 'Planned': 'b-neutral', 'Fixed': 'b-ok', 'Critical': 'b-danger',
    'Backlog': 'b-neutral', 'To Do': 'b-info', 'In Review': 'b-purple', 'Done': 'b-ok',
    'Upcoming ': 'b-info', 'Reached': 'b-ok', 'Missed': 'b-danger',
    // masters
    'Mandatory': 'b-danger', 'Optional': 'b-outline', 'In Force': 'b-ok', 'Superseded': 'b-neutral',
    'Visible': 'b-ok', 'Hidden': 'b-neutral', 'Granted': 'b-ok', 'Revoked': 'b-danger'
  };

  /* ---------------- SHARED PICKLISTS ---------------- */
  const PEOPLE = ['Arun Menon', 'Sneha Pillai', 'Rohit Deshmukh', 'Ayesha Khan', 'Karthik Nair',
    'Meera Joshi', 'Vikram Iyer', 'Nisha Kulkarni', 'Fatima Sheikh', 'Ravi Shankar',
    'Divya Raman', 'Imran Qureshi'];
  const CUSTOMERS = ['Trinetra Systems Pvt Ltd', 'Aarohi Retail Solutions', 'Kaveri Infotech LLP',
    'Nandan Logistics', 'Sahyadri Foods Pvt Ltd', 'Vaayu Media House', 'Pallava Constructions',
    'Indus Health Labs'];
  const VENDORS = ['Sundaram Office Supplies', 'Chola Technologies', 'Gokul Facility Services',
    'Anand Travels', 'Bharat Print House', 'Zenith IT Distributors'];
  const DEPTS = ['Engineering', 'Sales', 'Accounts', 'Human Resources', 'Support', 'Operations', 'Design'];

  /* ==========================================================================
     MOCK DATA
     ========================================================================== */
  const D = {};

  D.finance = { invoiced: 18450000, received: 14230000, outstanding: 4220000, overdue: 7, expenses: 1860000, projects: 12, tickets: 23, employees: 148, payables: 2640000 };

  /* ---- Employees ---- */
  D.employees = [
    { id: 'EMP-2026-0001', name: 'Ravi Shankar',   dept: 'Operations',      desig: 'Founder & CEO',      type: 'Full Time', status: 'Active',    mgr: '—',            phone: '98400 11001', join: '01-04-2019', loc: 'Chennai',    email: 'ravi.shankar@meshrd.in' },
    { id: 'EMP-2026-0002', name: 'Vikram Iyer',    dept: 'Engineering',     desig: 'Engineering Manager', type: 'Full Time', status: 'Active',   mgr: 'Ravi Shankar', phone: '98400 11002', join: '12-06-2020', loc: 'Chennai',    email: 'vikram.iyer@meshrd.in' },
    { id: 'EMP-2026-0003', name: 'Nisha Kulkarni', dept: 'Accounts',        desig: 'Senior Accountant',  type: 'Full Time', status: 'Active',    mgr: 'Ravi Shankar', phone: '98400 11003', join: '03-02-2021', loc: 'Chennai',    email: 'nisha.k@meshrd.in' },
    { id: 'EMP-2026-0004', name: 'Fatima Sheikh',  dept: 'Human Resources', desig: 'HR Manager',         type: 'Full Time', status: 'Active',    mgr: 'Ravi Shankar', phone: '98400 11004', join: '19-07-2021', loc: 'Chennai',    email: 'fatima.sheikh@meshrd.in' },
    { id: 'EMP-2026-0005', name: 'Arun Menon',     dept: 'Engineering',     desig: 'Senior Engineer',    type: 'Full Time', status: 'Active',    mgr: 'Vikram Iyer',  phone: '98400 11005', join: '05-09-2022', loc: 'Chennai',    email: 'arun.menon@meshrd.in' },
    { id: 'EMP-2026-0006', name: 'Sneha Pillai',   dept: 'Engineering',     desig: 'Engineer',           type: 'Full Time', status: 'Active',    mgr: 'Vikram Iyer',  phone: '98400 11006', join: '14-11-2022', loc: 'Coimbatore', email: 'sneha.pillai@meshrd.in' },
    { id: 'EMP-2026-0007', name: 'Rohit Deshmukh', dept: 'Engineering',     desig: 'Engineer',           type: 'Full Time', status: 'Active',    mgr: 'Vikram Iyer',  phone: '98400 11007', join: '02-01-2023', loc: 'Chennai',    email: 'rohit.d@meshrd.in' },
    { id: 'EMP-2026-0008', name: 'Ayesha Khan',    dept: 'Design',          desig: 'Product Designer',   type: 'Full Time', status: 'Active',    mgr: 'Vikram Iyer',  phone: '98400 11008', join: '17-04-2023', loc: 'Chennai',    email: 'ayesha.khan@meshrd.in' },
    { id: 'EMP-2026-0009', name: 'Karthik Nair',   dept: 'Support',         desig: 'Support Engineer',   type: 'Full Time', status: 'Active',    mgr: 'Vikram Iyer',  phone: '98400 11009', join: '08-08-2023', loc: 'Coimbatore', email: 'karthik.nair@meshrd.in' },
    { id: 'EMP-2026-0010', name: 'Meera Joshi',    dept: 'Sales',           desig: 'Account Executive',  type: 'Full Time', status: 'Active',    mgr: 'Vikram Iyer',  phone: '98400 11010', join: '21-01-2024', loc: 'Chennai',    email: 'meera.joshi@meshrd.in' },
    { id: 'EMP-2026-0011', name: 'Divya Raman',    dept: 'Sales',           desig: 'Sales Executive',    type: 'Full Time', status: 'Active',    mgr: 'Meera Joshi',  phone: '98400 11011', join: '27-07-2026', loc: 'Chennai',    email: 'divya.raman@meshrd.in' },
    { id: 'EMP-2026-0012', name: 'Imran Qureshi',  dept: 'Engineering',     desig: 'Intern',             type: 'Intern',    status: 'Active',    mgr: 'Vikram Iyer',  phone: '98400 11012', join: '23-07-2026', loc: 'Chennai',    email: 'imran.q@meshrd.in' },
    { id: 'EMP-2026-0013', name: 'Suresh Babu',    dept: 'Operations',      desig: 'Operations Lead',    type: 'Full Time', status: 'On Notice', mgr: 'Ravi Shankar', phone: '98400 11013', join: '11-03-2021', loc: 'Chennai',    email: 'suresh.babu@meshrd.in' },
    { id: 'EMP-2026-0014', name: 'Priya Varma',    dept: 'Design',          desig: 'Junior Designer',    type: 'Contract',  status: 'Exited',    mgr: 'Ayesha Khan',  phone: '98400 11014', join: '02-05-2024', loc: 'Chennai',    email: 'priya.varma@meshrd.in' }
  ];
  D.team = D.employees.filter(e => e.mgr === 'Vikram Iyer');

  /* ---- Leave ---- */
  D.leaveBal = [
    { t: 'Casual Leave', allowed: 12, cf: 0,   taken: 5.5, pending: 0, tone: 'var(--accent)' },
    { t: 'Sick Leave',   allowed: 8,  cf: 0,   taken: 4,   pending: 0, tone: 'var(--info)' },
    { t: 'Earned Leave', allowed: 15, cf: 3,   taken: 4,   pending: 2, tone: 'var(--success)' },
    { t: 'Comp Off',     allowed: 2,  cf: 0,   taken: 0,   pending: 0, tone: 'var(--warning)' },
    { t: 'Work From Home', allowed: 0, cf: 0,  taken: 6,   pending: 0, tone: 'var(--purple)' }
  ];
  D.myLeave = [
    { type: 'Earned Leave', from: '18-08-2026', to: '22-08-2026', days: 5, half: 'No',  reason: 'Family function in Kochi',   status: 'Pending',   by: '—',            applied: '26-07-2026', actioned: '—' },
    { type: 'Casual Leave', from: '11-07-2026', to: '11-07-2026', days: 1, half: 'No',  reason: 'Personal work',              status: 'Approved',  by: 'Vikram Iyer',  applied: '08-07-2026', actioned: '09-07-2026' },
    { type: 'Sick Leave',   from: '02-06-2026', to: '05-06-2026', days: 4, half: 'No',  reason: 'Viral fever, medical cert attached', status: 'Approved', by: 'Vikram Iyer', applied: '02-06-2026', actioned: '02-06-2026' },
    { type: 'Casual Leave', from: '19-05-2026', to: '19-05-2026', days: 0.5, half: 'Yes', reason: 'Bank work — first half',   status: 'Approved',  by: 'Vikram Iyer',  applied: '17-05-2026', actioned: '17-05-2026' },
    { type: 'Casual Leave', from: '04-04-2026', to: '07-04-2026', days: 4, half: 'No',  reason: 'Travel',                     status: 'Rejected',  by: 'Vikram Iyer',  applied: '28-03-2026', actioned: '30-03-2026' },
    { type: 'Work From Home', from: '12-03-2026', to: '13-03-2026', days: 2, half: 'No', reason: 'House repairs',             status: 'Approved',  by: 'Vikram Iyer',  applied: '11-03-2026', actioned: '11-03-2026' }
  ];
  D.leaveApprovals = [
    { emp: 'Sneha Pillai',   type: 'Casual Leave', dates: '04–06 Aug 2026', days: 3, reason: 'Cousin\'s wedding',        applied: '25-07-2026', routed: 'Vikram Iyer', aging: 4 },
    { emp: 'Rohit Deshmukh', type: 'Sick Leave',   dates: '11 Aug 2026',    days: 1, reason: 'Dental procedure',         applied: '27-07-2026', routed: 'Vikram Iyer', aging: 2 },
    { emp: 'Ayesha Khan',    type: 'Earned Leave', dates: '18–22 Aug 2026', days: 5, reason: 'Annual holiday, booked',   applied: '20-07-2026', routed: 'Vikram Iyer', aging: 9 },
    { emp: 'Karthik Nair',   type: 'Comp Off',     dates: '29 Jul 2026',    days: 1, reason: 'Worked Sunday release',    applied: '28-07-2026', routed: 'Vikram Iyer', aging: 1 },
    { emp: 'Meera Joshi',    type: 'Casual Leave', dates: '01 Aug 2026',    days: 1, reason: 'Personal',                 applied: '29-07-2026', routed: 'Vikram Iyer', aging: 0 },
    { emp: 'Vikram Iyer',    type: 'Earned Leave', dates: '08–12 Sep 2026', days: 5, reason: 'Family trip',              applied: '22-07-2026', routed: 'HR', aging: 7 },
    { emp: 'Nisha Kulkarni', type: 'Casual Leave', dates: '14 Aug 2026',    days: 1, reason: 'Personal',                 applied: '24-07-2026', routed: 'HR', aging: 5 }
  ];
  D.leaveBalanceAdmin = D.employees.filter(e => e.status !== 'Exited').slice(0, 10).map((e, i) => ({
    emp: e.name, allowed: 12, cf: [0, 2, 1, 3, 0, 1, 2, 0, 4, 1][i], taken: [5.5, 3, 7, 2, 4, 6, 1, 8, 0, 2][i],
    pending: [0, 3, 0, 1, 0, 0, 2, 0, 0, 1][i]
  }));
  D.holidays = [
    { name: 'Independence Day',    date: '15-08-2026', day: 'Saturday',  type: 'Mandatory', m: 'Aug', d: 15 },
    { name: 'Ganesh Chaturthi',    date: '14-09-2026', day: 'Monday',    type: 'Optional',  m: 'Sep', d: 14 },
    { name: 'Gandhi Jayanti',      date: '02-10-2026', day: 'Friday',    type: 'Mandatory', m: 'Oct', d: 2 },
    { name: 'Ayudha Pooja',        date: '19-10-2026', day: 'Monday',    type: 'Optional',  m: 'Oct', d: 19 },
    { name: 'Diwali',              date: '08-11-2026', day: 'Sunday',    type: 'Mandatory', m: 'Nov', d: 8 },
    { name: 'Christmas',           date: '25-12-2026', day: 'Friday',    type: 'Mandatory', m: 'Dec', d: 25 },
    { name: 'New Year',            date: '01-01-2027', day: 'Friday',    type: 'Mandatory', m: 'Jan', d: 1 },
    { name: 'Pongal',              date: '15-01-2027', day: 'Friday',    type: 'Mandatory', m: 'Jan', d: 15 },
    { name: 'Thiruvalluvar Day',   date: '16-01-2027', day: 'Saturday',  type: 'Optional',  m: 'Jan', d: 16 },
    { name: 'Republic Day',        date: '26-01-2027', day: 'Tuesday',   type: 'Mandatory', m: 'Jan', d: 26 },
    { name: 'Holi',                date: '03-03-2027', day: 'Wednesday', type: 'Optional',  m: 'Mar', d: 3 },
    { name: 'Telugu New Year',     date: '18-03-2027', day: 'Thursday',  type: 'Optional',  m: 'Mar', d: 18 }
  ];

  /* ---- Payroll ---- */
  D.payslip = { period: 'June 2026', net: 86420, gross: 112500, deductions: 26080, days: 30, status: 'Processed' };
  D.myPayslips = [
    { period: 'June 2026',     net: 86420, processed: '01-07-2026', status: 'Processed' },
    { period: 'May 2026',      net: 86420, processed: '01-06-2026', status: 'Processed' },
    { period: 'April 2026',    net: 84150, processed: '01-05-2026', status: 'Reissued' },
    { period: 'March 2026',    net: 81900, processed: '01-04-2026', status: 'Processed' },
    { period: 'February 2026', net: 81900, processed: '01-03-2026', status: 'Processed' },
    { period: 'January 2026',  net: 81900, processed: '01-02-2026', status: 'Processed' }
  ];
  D.payrollRuns = [
    { period: 'June 2026',     month: 'June',     year: 2026, status: 'Processed', by: 'Nisha Kulkarni', on: '01-07-2026', count: 13, net: 1148600 },
    { period: 'May 2026',      month: 'May',      year: 2026, status: 'Processed', by: 'Nisha Kulkarni', on: '01-06-2026', count: 13, net: 1148600 },
    { period: 'April 2026',    month: 'April',    year: 2026, status: 'Processed', by: 'Nisha Kulkarni', on: '01-05-2026', count: 12, net: 1094300 },
    { period: 'July 2026',     month: 'July',     year: 2026, status: 'Draft',     by: 'Nisha Kulkarni', on: '29-07-2026', count: 14, net: 1216400 }
  ];
  D.payrollRegister = D.employees.filter(e => e.status === 'Active').slice(0, 10).map((e, i) => ({
    emp: e.name, code: e.id, month: 'June 2026', status: i === 9 ? 'Pending' : 'Processed',
    net: [148000, 132000, 96000, 104000, 86420, 72500, 68900, 79200, 61500, 58400][i]
  }));
  D.adhoc = [
    { emp: 'Arun Menon',     label: 'Diwali Bonus',              type: 'Addition',    amt: 15000, taxable: 'Yes', rec: 'No',  by: 'Nisha Kulkarni', on: '24-07-2026' },
    { emp: 'All Active Employees', label: 'Annual Day Gift Voucher', type: 'Addition', amt: 2500, taxable: 'Yes', rec: 'No',  by: 'Ravi Shankar',   on: '22-07-2026' },
    { emp: 'Rohit Deshmukh', label: 'Laptop Advance Recovery',   type: 'Subtraction', amt: 4000,  taxable: 'No',  rec: 'Yes', by: 'Nisha Kulkarni', on: '15-06-2026' },
    { emp: 'Divya Raman',    label: 'Signing Bonus per Offer Letter', type: 'Addition', amt: 50000, taxable: 'Yes', rec: 'No', by: 'Fatima Sheikh',  on: '27-07-2026' },
    { emp: 'Sneha Pillai',   label: 'Referral Bonus — Imran Q',  type: 'Addition',    amt: 10000, taxable: 'Yes', rec: 'No',  by: 'Fatima Sheikh',  on: '23-07-2026' }
  ];

  /* ---- Assets ---- */
  D.assets = [
    { tag: 'AST-2026-0001', name: 'MacBook Pro 14" M3',      cat: 'Laptop',      status: 'In Use',           to: 'Arun Menon',     pv: 185000, cv: 138750, serial: 'C02XL0AAJGH5', loc: 'Chennai',    pdate: '12-04-2024', warranty: '11-04-2027' },
    { tag: 'AST-2026-0002', name: 'Dell Latitude 5440',      cat: 'Laptop',      status: 'In Use',           to: 'Sneha Pillai',   pv: 92000,  cv: 61333,  serial: 'DL5440XK221',  loc: 'Coimbatore', pdate: '05-06-2023', warranty: '04-06-2026' },
    { tag: 'AST-2026-0003', name: 'Dell UltraSharp U2723QE', cat: 'Monitor',     status: 'In Use',           to: 'Rohit Deshmukh', pv: 48000,  cv: 33600,  serial: 'MN27QE9931',   loc: 'Chennai',    pdate: '18-08-2023', warranty: '17-08-2026' },
    { tag: 'AST-2026-0004', name: 'iPhone 14 (Test Device)',  cat: 'Mobile',      status: 'In Store',         to: '—',              pv: 61000,  cv: 40667,  serial: 'IP14TST0021',  loc: 'Chennai',    pdate: '02-02-2024', warranty: '01-02-2026' },
    { tag: 'AST-2026-0005', name: 'Herman Miller Sayl Chair', cat: 'Furniture',   status: 'In Use',           to: 'Ayesha Khan',    pv: 42000,  cv: 35000,  serial: 'HM-SYL-8814',  loc: 'Chennai',    pdate: '21-01-2025', warranty: '—' },
    { tag: 'AST-2026-0006', name: 'HP LaserJet Pro MFP',      cat: 'Printer',     status: 'Under Repair',     to: '—',              pv: 34000,  cv: 20400,  serial: 'HPLJ441209',   loc: 'Chennai',    pdate: '14-09-2023', warranty: '13-09-2025' },
    { tag: 'AST-2026-0007', name: 'Lenovo ThinkPad T14',      cat: 'Laptop',      status: 'In Use',           to: 'Karthik Nair',   pv: 88000,  cv: 66000,  serial: 'LNV-T14-3391', loc: 'Coimbatore', pdate: '30-03-2024', warranty: '29-03-2027' },
    { tag: 'AST-2026-0008', name: 'Cisco Catalyst Switch',    cat: 'Networking',  status: 'In Use',           to: '—',              pv: 126000, cv: 84000,  serial: 'CSC-CT-77120', loc: 'Chennai',    pdate: '09-11-2023', warranty: '08-11-2028' },
    { tag: 'AST-2026-0009', name: 'Dell Latitude 3420',       cat: 'Laptop',      status: 'Retired-Disposed', to: '—',              pv: 64000,  cv: 0,      serial: 'DL3420OLD01',  loc: 'Chennai',    pdate: '15-05-2021', warranty: '14-05-2024' },
    { tag: 'AST-2026-0010', name: 'Logitech MX Master 3S',    cat: 'Peripheral',  status: 'In Use',           to: 'Arun Menon',     pv: 9500,   cv: 6333,   serial: 'LG-MX3S-118',  loc: 'Chennai',    pdate: '12-04-2024', warranty: '11-04-2026' }
  ];
  D.myAssets = D.assets.filter(a => a.to === 'Arun Menon');
  D.assetRequests = [
    { emp: 'Rohit Deshmukh', asset: 'AST-2026-0003 · Dell UltraSharp U2723QE', type: 'Repair',        raised: '26-07-2026', status: 'Pending',  desc: 'Monitor flickers on the left third of the panel' },
    { emp: 'Sneha Pillai',   asset: 'AST-2026-0002 · Dell Latitude 5440',      type: 'Damage Report', raised: '24-07-2026', status: 'Pending',  desc: 'Hinge cracked after a fall; screen still works' },
    { emp: 'Karthik Nair',   asset: 'AST-2026-0007 · Lenovo ThinkPad T14',     type: 'Return',        raised: '21-07-2026', status: 'Approved', desc: 'Switching to the new machine issued last week' },
    { emp: 'Ayesha Khan',    asset: 'AST-2026-0005 · Herman Miller Sayl Chair',type: 'Repair',        raised: '18-07-2026', status: 'Rejected', desc: 'Armrest loose — reviewed, within normal wear' }
  ];
  D.maintenance = [
    { tag: 'AST-2026-0006', name: 'HP LaserJet Pro MFP',   date: '26-07-2026', desc: 'Fuser assembly replacement',        cost: 6800, next: '26-01-2027', status: 'Upcoming' },
    { tag: 'AST-2026-0002', name: 'Dell Latitude 5440',    date: '12-06-2026', desc: 'Battery replaced under warranty',   cost: 0,    next: '—',          status: 'Completed' },
    { tag: 'AST-2026-0008', name: 'Cisco Catalyst Switch', date: '05-04-2026', desc: 'Annual firmware + config audit',    cost: 12500, next: '05-04-2027', status: 'Upcoming' },
    { tag: 'AST-2026-0001', name: 'MacBook Pro 14" M3',    date: '18-02-2026', desc: 'Keyboard cleaning + thermal check', cost: 2200, next: '18-02-2027', status: 'Upcoming' },
    { tag: 'AST-2026-0003', name: 'Dell UltraSharp U2723QE', date: '02-01-2026', desc: 'Panel calibration',               cost: 1500, next: '02-07-2026', status: 'Overdue' }
  ];
  D.assignHistory = [
    { emp: 'Arun Menon',   from: '15-04-2024', to: '—',          action: 'Assigned',    by: 'Fatima Sheikh', reason: '—' },
    { emp: 'Rohit Deshmukh', from: '12-04-2024', to: '15-04-2024', action: 'Transferred', by: 'Fatima Sheikh', reason: 'Reallocated to a senior engineer on the platform team' },
    { emp: '—',            from: '12-04-2024', to: '12-04-2024', action: 'Assigned',    by: 'Ravi Shankar',  reason: 'Initial assignment at purchase' }
  ];
  D.reclaim = [
    { tag: 'AST-2026-0011', name: 'Dell OptiPlex 7010', cat: 'Desktop',   assigned: '11-03-2021' },
    { tag: 'AST-2026-0012', name: 'Company ID Card',    cat: 'Access',    assigned: '11-03-2021' },
    { tag: 'AST-2026-0013', name: 'Samsung 24" Monitor', cat: 'Monitor',  assigned: '04-08-2022' }
  ];

  /* ---- Tickets ---- */
  D.tickets = [
    { no: 'TKT-2026-0912', cust: 'Trinetra Systems Pvt Ltd', subj: 'Login fails after SSO migration',        cat: 'Access',      pri: 'Urgent', status: 'In Progress', to: 'Arun Menon',   raised: '28-07-2026', frt: '22m',  proj: 'SSO & Identity Hardening' },
    { no: 'TKT-2026-0911', cust: 'Aarohi Retail Solutions',  subj: 'Stock sync stopped overnight',           cat: 'Integration', pri: 'High',   status: 'Open',        to: 'Unassigned',   raised: '28-07-2026', frt: '—',    proj: 'Aarohi Multi-branch Phase 1' },
    { no: 'TKT-2026-0910', cust: 'Kaveri Infotech LLP',      subj: 'Report export produces empty PDF',       cat: 'Bug',         pri: 'High',   status: 'In Progress', to: 'Karthik Nair', raised: '27-07-2026', frt: '1h 05m', proj: 'Kaveri Reporting Fixes' },
    { no: 'TKT-2026-0909', cust: 'Nandan Logistics',         subj: 'Request: add a driver-wise summary',     cat: 'Enhancement', pri: 'Low',    status: 'Open',        to: 'Unassigned',   raised: '26-07-2026', frt: '—',    proj: 'Nandan Fleet Dashboard' },
    { no: 'TKT-2026-0908', cust: 'Sahyadri Foods Pvt Ltd',   subj: 'Invoice email bounced',                  cat: 'Billing',     pri: 'Medium', status: 'Resolved',    to: 'Arun Menon',   raised: '24-07-2026', frt: '3h 40m', proj: '—' },
    { no: 'TKT-2026-0907', cust: 'Vaayu Media House',        subj: 'Slow dashboard load on Safari',          cat: 'Performance', pri: 'Medium', status: 'In Progress', to: 'Sneha Pillai', raised: '23-07-2026', frt: '48m',  proj: 'Vaayu Asset Tracker' },
    { no: 'TKT-2026-0906', cust: 'Trinetra Systems Pvt Ltd', subj: 'Add two more user seats',                cat: 'Account',     pri: 'Low',    status: 'Closed',      to: 'Arun Menon',   raised: '21-07-2026', frt: '2h 12m', proj: '—' },
    { no: 'TKT-2026-0905', cust: 'Pallava Constructions',    subj: 'Mobile app crashes on scan',             cat: 'Bug',         pri: 'Urgent', status: 'Resolved',    to: 'Rohit Deshmukh', raised: '19-07-2026', frt: '18m', proj: '—' },
    { no: 'TKT-2026-0904', cust: 'Indus Health Labs',        subj: 'Data migration checklist needed',        cat: 'Onboarding',  pri: 'Medium', status: 'Closed',      to: 'Karthik Nair', raised: '17-07-2026', frt: '4h 55m', proj: '—' },
    { no: 'TKT-2026-0903', cust: 'Kaveri Infotech LLP',      subj: 'Password reset emails delayed',          cat: 'Access',      pri: 'High',   status: 'Closed',      to: 'Arun Menon',   raised: '15-07-2026', frt: '35m',  proj: '—' }
  ];
  D.myTickets = D.tickets.filter(t => t.to === 'Arun Menon');
  D.conversation = [
    { who: 'Priya Nandakumar', init: 'PN', type: 'Public Reply', when: '28-07-2026 09:14', text: 'Since the SSO migration last night none of our finance users can sign in. They get "identity provider returned no email claim". Roughly 20 people are blocked.' },
    { who: 'Arun Menon', init: 'AM', type: 'Public Reply', when: '28-07-2026 09:36', text: 'Thanks for the detail — that error means the SAML assertion is missing the email attribute. I have raised the priority to Urgent and I am checking your tenant config now. I will come back within the hour.' },
    { who: 'Arun Menon', init: 'AM', type: 'Internal Note', when: '28-07-2026 09:52', text: 'Their IdP is sending emailAddress instead of email in the assertion. We can map it on our side, but confirm with Vikram whether we want a per-tenant attribute mapping or ask them to change the claim. Per-tenant mapping is probably safer.' },
    { who: 'Vikram Iyer', init: 'VI', type: 'Internal Note', when: '28-07-2026 10:07', text: 'Go with the per-tenant mapping. Three other customers will hit this eventually. Log a Task on PRJ-2026-0003 so it does not stay a one-off patch.' },
    { who: 'Arun Menon', init: 'AM', type: 'Public Reply', when: '28-07-2026 10:41', text: 'We have added an attribute mapping on your tenant so the emailAddress claim is accepted. Could you ask one of the affected users to try signing in again and confirm?' }
  ];

  /* ---- Customers ---- */
  D.customers = [
    { name: 'Trinetra Systems Pvt Ltd', code: 'CUST-2026-0001', status: 'Active',   owner: 'Meera Joshi', inv: 6840000, out: 842000,  gstin: '33AABCT1234M1Z5', city: 'Chennai',    source: 'Referral',        bname: 'Trinetra Systems Pvt Ltd', bacc: 'HDFC ••••9021', collect: 'Meshrd Current — Chennai' },
    { name: 'Kaveri Infotech LLP',      code: 'CUST-2026-0002', status: 'Active',   owner: 'Meera Joshi', inv: 4250000, out: 1250000, gstin: '29AACCK5678N1Z2', city: 'Bengaluru',  source: 'Website',         bname: 'Kaveri Infotech LLP', bacc: 'ICICI ••••4408', collect: 'Meshrd Current — Chennai' },
    { name: 'Aarohi Retail Solutions',  code: 'CUST-2026-0003', status: 'Active',   owner: 'Divya Raman', inv: 2980000, out: 465500,  gstin: '27AAFCA9012P1Z8', city: 'Pune',       source: 'Partner',         bname: 'Aarohi Retail Solutions', bacc: 'Axis ••••1173',  collect: 'Meshrd Current — Chennai' },
    { name: 'Nandan Logistics',         code: 'CUST-2026-0004', status: 'Active',   owner: 'Divya Raman', inv: 1875000, out: 187400,  gstin: '33AAGCN3456Q1Z4', city: 'Coimbatore', source: 'Cold Outreach',  bname: 'Nandan Logistics', bacc: 'SBI ••••6650',   collect: 'Meshrd Payroll Account' },
    { name: 'Sahyadri Foods Pvt Ltd',   code: 'CUST-2026-0005', status: 'Active',   owner: 'Meera Joshi', inv: 1420000, out: 96800,   gstin: '27AAHCS7890R1Z1', city: 'Nashik',     source: 'Inbound Enquiry', bname: 'Sahyadri Foods Pvt Ltd', bacc: 'HDFC ••••3392',  collect: 'Meshrd Current — Chennai' },
    { name: 'Vaayu Media House',        code: 'CUST-2026-0006', status: 'Active',   owner: 'Divya Raman', inv: 685000,  out: 0,       gstin: '33AAJCV2345S1Z9', city: 'Chennai',    source: 'Referral',        bname: 'Vaayu Media House', bacc: 'Kotak ••••7784', collect: 'Meshrd Current — Chennai' },
    { name: 'Pallava Constructions',    code: 'CUST-2026-0007', status: 'Prospect', owner: 'Meera Joshi', inv: 0, out: 0,    gstin: '33AAKCP6789T1Z6', city: 'Chennai',    source: 'Cold Outreach',  bname: '—', bacc: '—',              collect: '—' },
    { name: 'Indus Health Labs',        code: 'CUST-2026-0008', status: 'Inactive',   owner: 'Divya Raman', inv: 400000,  out: 0,       gstin: '36AALCI0123U1Z3', city: 'Hyderabad',  source: 'Website',         bname: 'Indus Health Labs', bacc: 'SBI ••••2215',   collect: 'Meshrd Current — Chennai' }
  ];
  D.contacts = [
    { name: 'Priya Nandakumar', desig: 'IT Manager',        email: 'priya.n@trinetra.in',  phone: '98410 22001', primary: 'Yes' },
    { name: 'Ganesh Subramani',  desig: 'Finance Head',      email: 'ganesh.s@trinetra.in', phone: '98410 22002', primary: 'No' },
    { name: 'Lakshmi Venkat',    desig: 'Procurement Lead',  email: 'lakshmi.v@trinetra.in',phone: '98410 22003', primary: 'No' }
  ];
  D.activities = [
    { type: 'Meeting', date: '27-07-2026', by: 'Meera Joshi', contact: 'Priya Nandakumar', desc: 'Quarterly review at their Guindy office. Walked through the renewal scope and the two open enhancement requests. They want the driver-summary report before signing.' },
    { type: 'Call',    date: '22-07-2026', by: 'Meera Joshi', contact: 'Ganesh Subramani', desc: 'Chased the outstanding ₹8.42L on INV-2627-0142. Finance says it is queued for the 5 August payment run.' },
    { type: 'Email',   date: '15-07-2026', by: 'Divya Raman', contact: 'Priya Nandakumar', desc: 'Sent the revised proposal for the analytics add-on. Awaiting their internal approval.' },
    { type: 'Note',    date: '02-07-2026', by: 'Meera Joshi', contact: '—',                desc: 'Their parent group is consolidating vendors this year. Worth getting ahead of it — flagged to Ravi.' }
  ];

  /* ---- Opportunities ---- */
  D.opportunities = [
    { title: 'Analytics add-on — Trinetra',       code: 'OPP-2026-0001', cust: 'Trinetra Systems Pvt Ltd', val: 1850000, stage: 'Proposal',    prob: 60,  close: '30-08-2026', owner: 'Meera Joshi' },
    { title: 'Warehouse module — Nandan',         code: 'OPP-2026-0002', cust: 'Nandan Logistics',         val: 2400000, stage: 'Qualifying',  prob: 30,  close: '15-09-2026', owner: 'Divya Raman' },
    { title: 'Multi-branch rollout — Aarohi',     code: 'OPP-2026-0003', cust: 'Aarohi Retail Solutions',  val: 3600000, stage: 'Proposal',    prob: 60,  close: '10-09-2026', owner: 'Divya Raman' },
    { title: 'ERP integration — Kaveri',          code: 'OPP-2026-0004', cust: 'Kaveri Infotech LLP',      val: 1200000, stage: 'Prospecting', prob: 10,  close: '31-10-2026', owner: 'Meera Joshi' },
    { title: 'Compliance pack — Sahyadri',        code: 'OPP-2026-0005', cust: 'Sahyadri Foods Pvt Ltd',   val: 680000,  stage: 'Won',         prob: 100, close: '12-07-2026', owner: 'Meera Joshi' },
    { title: 'Site portal — Pallava',             code: 'OPP-2026-0006', cust: 'Pallava Constructions',    val: 950000,  stage: 'Qualifying',  prob: 30,  close: '20-09-2026', owner: 'Meera Joshi' },
    { title: 'LIMS bridge — Indus Health',        code: 'OPP-2026-0007', cust: 'Indus Health Labs',        val: 1450000, stage: 'Lost',        prob: 0,   close: '30-06-2026', owner: 'Divya Raman' },
    { title: 'Media asset tracker — Vaayu',       code: 'OPP-2026-0008', cust: 'Vaayu Media House',        val: 540000,  stage: 'Won',         prob: 100, close: '05-07-2026', owner: 'Divya Raman' }
  ];
  D.oppActivities = [
    { type: 'Call',    date: '28-07-2026', by: 'Meera Joshi', contact: 'Priya Nandakumar', desc: 'Walked Priya through the analytics add-on pricing. She wants a formal proposal before it goes to their finance head.' },
    { type: 'Meeting', date: '21-07-2026', by: 'Meera Joshi', contact: 'Priya Nandakumar', desc: 'Discovery call — confirmed scope: 12 custom reports, annual licence, 2-day onsite training. Budget sits within their FY26–27 allocation.' },
    { type: 'Email',   date: '15-07-2026', by: 'Divya Raman', contact: 'Ganesh Subramani', desc: 'Sent the revised proposal for the analytics add-on. Awaiting internal approval from their finance head.' },
    { type: 'Note',    date: '08-07-2026', by: 'Meera Joshi', contact: '—',                desc: 'Sourced through their quarterly review — they mentioned wanting deeper reporting during the renewal conversation.' }
  ];
  D.oppFiles = [
    { f: 'proposal-analytics-addon-v2.pdf', by: 'Divya Raman', on: '15-07-2026', sz: '640 KB' },
    { f: 'pricing-worksheet.xlsx',          by: 'Meera Joshi', on: '21-07-2026', sz: '112 KB' },
    { f: 'discovery-notes.docx',            by: 'Meera Joshi', on: '21-07-2026', sz: '48 KB' }
  ];
  /* ---- Projects ---- */
  /* `lead` = Project Lead, `members` = the Members multi-select (Project §2.2).
     Both are needed for scope: Project §2.1 says an Employee sees only projects they
     are a team member on — which means lead OR members, not just one of them.
     Arun Menon is deliberately on 3 of the 8 so Employee scope is visibly narrower. */
  D.projects = [
    { name: 'Trinetra Analytics Rollout',  code: 'PRJ-2026-0001', cust: 'Trinetra Systems Pvt Ltd', status: 'In Progress', start: '01-05-2026', end: '30-09-2026', budget: 1850000, lead: 'Vikram Iyer',     members: ['Arun Menon', 'Sneha Pillai', 'Rohit Deshmukh', 'Ayesha Khan'] },
    { name: 'Aarohi Multi-branch Phase 1', code: 'PRJ-2026-0002', cust: 'Aarohi Retail Solutions',  status: 'In Progress', start: '15-04-2026', end: '31-08-2026', budget: 2200000, lead: 'Vikram Iyer',     members: ['Sneha Pillai', 'Karthik Nair'] },
    { name: 'SSO & Identity Hardening',    code: 'PRJ-2026-0003', cust: 'Trinetra Systems Pvt Ltd', status: 'In Progress', start: '01-07-2026', end: '15-09-2026', budget: 640000,  lead: 'Arun Menon',      members: ['Rohit Deshmukh'] },
    { name: 'Nandan Fleet Dashboard',      code: 'PRJ-2026-0004', cust: 'Nandan Logistics',         status: 'Not Started', start: '15-08-2026', end: '20-12-2026', budget: 1400000, lead: 'Sneha Pillai',    members: ['Karthik Nair', 'Meera Joshi'] },
    { name: 'Sahyadri Compliance Pack',    code: 'PRJ-2026-0005', cust: 'Sahyadri Foods Pvt Ltd',   status: 'In Progress', start: '20-07-2026', end: '30-10-2026', budget: 680000,  lead: 'Ayesha Khan',     members: ['Arun Menon'] },
    { name: 'Vaayu Asset Tracker',         code: 'PRJ-2026-0006', cust: 'Vaayu Media House',        status: 'On Hold',     start: '10-06-2026', end: '30-09-2026', budget: 540000,  lead: 'Rohit Deshmukh',  members: ['Ayesha Khan'] },
    { name: 'Kaveri Reporting Fixes',      code: 'PRJ-2026-0007', cust: 'Kaveri Infotech LLP',      status: 'Completed',   start: '02-01-2026', end: '30-04-2026', budget: 320000,  lead: 'Karthik Nair',    members: ['Meera Joshi'] },
    { name: 'Internal — Platform Upgrade', code: 'PRJ-2026-0008', cust: 'Internal',                 status: 'In Progress', start: '01-06-2026', end: '31-12-2026', budget: 0,       lead: 'Vikram Iyer',     members: ['Sneha Pillai', 'Rohit Deshmukh', 'Karthik Nair'] }
  ];
  D.tasks = [
    { id: 'TSK-0141', t: 'Per-tenant SAML attribute mapping', s: 'In Progress', a: 'Arun Menon',     due: '02-08-2026', over: 0, pri: 'High',   proj: 'SSO & Identity Hardening',       sprint: 'Sprint 14 — SSO & Exports' },
    { id: 'TSK-0142', t: 'Rate limiter for the export API',   s: 'In Progress', a: 'Rohit Deshmukh', due: '30-07-2026', over: 1, pri: 'High',   proj: 'Trinetra Analytics Rollout',     sprint: 'Sprint 14 — SSO & Exports' },
    { id: 'TSK-0138', t: 'Dashboard widget: driver summary',  s: 'To Do',       a: 'Sneha Pillai',   due: '08-08-2026', over: 0, pri: 'Medium', proj: 'Nandan Fleet Dashboard',         sprint: 'Sprint 14 — SSO & Exports' },
    { id: 'TSK-0139', t: 'Migrate report templates to v2',    s: 'To Do',       a: 'Karthik Nair',   due: '12-08-2026', over: 0, pri: 'Medium', proj: 'Aarohi Multi-branch Phase 1',    sprint: 'Sprint 14 — SSO & Exports' },
    { id: 'TSK-0144', t: 'Design review — settings screens',  s: 'In Review',   a: 'Ayesha Khan',    due: '31-07-2026', over: 0, pri: 'Medium', proj: 'Trinetra Analytics Rollout',     sprint: 'Sprint 14 — SSO & Exports' },
    { id: 'TSK-0130', t: 'Audit log retention policy',        s: 'Backlog',     a: 'Arun Menon',     due: '—',          over: 0, pri: 'Low',    proj: 'SSO & Identity Hardening',       sprint: '—' },
    { id: 'TSK-0131', t: 'Bulk import: CSV column mapping',   s: 'Backlog',     a: 'Unassigned',     due: '—',          over: 0, pri: 'Low',    proj: 'Aarohi Multi-branch Phase 1',    sprint: '—' },
    { id: 'TSK-0128', t: 'Set up staging data refresh',       s: 'Done',        a: 'Rohit Deshmukh', due: '18-07-2026', over: 0, pri: 'Medium', proj: 'Internal — Platform Upgrade',    sprint: 'Sprint 13 — Reporting v2' },
    { id: 'TSK-0126', t: 'SSO discovery + tenant audit',      s: 'Done',        a: 'Arun Menon',     due: '10-07-2026', over: 0, pri: 'High',   proj: 'SSO & Identity Hardening',       sprint: 'Sprint 12 — Mobile fixes' },
    { id: 'TSK-0143', t: 'Write the migration runbook',       s: 'To Do',       a: 'Karthik Nair',   due: '05-08-2026', over: 0, pri: 'Low',    proj: 'Internal — Platform Upgrade',    sprint: 'Sprint 14 — SSO & Exports' }
  ];
  D.bugs = [
    { id: 'BUG-0071', t: 'Export produces an empty PDF above 5k rows', sev: 'Critical', s: 'In Progress', a: 'Karthik Nair',   due: '31-07-2026' },
    { id: 'BUG-0072', t: 'Mobile scan crashes on Android 15',          sev: 'Critical', s: 'Fixed',       a: 'Rohit Deshmukh', due: '25-07-2026' },
    { id: 'BUG-0069', t: 'Dashboard slow to paint on Safari 18',       sev: 'High',     s: 'Open',        a: 'Sneha Pillai',   due: '06-08-2026' },
    { id: 'BUG-0070', t: 'Date filter ignores the financial-year preset', sev: 'High',  s: 'In Progress', a: 'Arun Menon',     due: '02-08-2026' },
    { id: 'BUG-0066', t: 'Tooltip clipped inside scroll containers',   sev: 'Medium',   s: 'Open',        a: 'Unassigned',     due: '—' },
    { id: 'BUG-0064', t: 'Currency abbreviation rounds 99,950 wrong',  sev: 'Medium',   s: 'Fixed',       a: 'Ayesha Khan',    due: '20-07-2026' },
    { id: 'BUG-0060', t: 'Column sort resets after pagination',        sev: 'Low',      s: 'Closed',      a: 'Karthik Nair',   due: '12-07-2026' }
  ];
  D.sprints = [
    /* tasks: for the current sprint this is the live count of D.tasks actually linked to it —
       not a typed-in number — so Sprints, the Task Board, and Task Detail can never disagree
       about who is in Sprint 14. Completed sprints keep their historical total: most of that
       work has aged out of the 10-task mock set this prototype keeps around, the same way a
       real closed sprint's tasks eventually drop off an active board. */
    { name: 'Sprint 14 — SSO & Exports', start: '21-07-2026', end: '03-08-2026', status: 'Planned',   tasks: D.tasks.filter(t => t.sprint === 'Sprint 14 — SSO & Exports').length },
    { name: 'Sprint 13 — Reporting v2',  start: '07-07-2026', end: '20-07-2026', status: 'Completed', tasks: 11 },
    { name: 'Sprint 12 — Mobile fixes',  start: '23-06-2026', end: '06-07-2026', status: 'Completed', tasks: 9 }
  ];
  D.sprintsActive = D.sprints.filter(s => s.status === 'Planned' || s.status === 'Active');
  D.milestones = [
    { name: 'Discovery sign-off',        target: '15-05-2026', status: 'Reached',  linked: '4/4' },
    { name: 'Data migration dry run',    target: '30-06-2026', status: 'Reached',  linked: '6/6' },
    { name: 'UAT start',                 target: '20-07-2026', status: 'Missed',   linked: '5/8' },
    { name: 'Go-live — phase 1',         target: '15-09-2026', status: 'Upcoming', linked: '2/11' },
    { name: 'Handover & training',       target: '30-09-2026', status: 'Upcoming', linked: '0/5' }
  ];
  D.timesheet = [
    { date: '29-07-2026', task: 'TSK-0141 · Per-tenant SAML attribute mapping', hours: 6.5, notes: 'Mapping layer + tenant config UI', status: 'Submitted', person: 'Arun Menon' },
    { date: '29-07-2026', task: 'Bench / Free Time',                            hours: 1.5, notes: 'Finished the mapping layer early — no other task ready to pick up yet', status: 'Submitted', person: 'Arun Menon' },
    { date: '28-07-2026', task: 'TSK-0141 · Per-tenant SAML attribute mapping', hours: 7,   notes: 'Investigated TKT-0912, root cause found', status: 'Approved', person: 'Arun Menon' },
    { date: '27-07-2026', task: 'TSK-0126 · SSO discovery + tenant audit',      hours: 8,   notes: 'Audited all 14 tenants', status: 'Approved', person: 'Arun Menon' },
    { date: '26-07-2026', task: 'TSK-0130 · Audit log retention policy',        hours: 3,   notes: 'Draft policy circulated', status: 'Approved', person: 'Arun Menon' },
    { date: '26-07-2026', task: 'Internal Meeting',                            hours: 1,   notes: 'Sprint planning for Sprint 14', status: 'Approved', person: 'Arun Menon' },
    { date: '29-07-2026', task: 'TSK-0142 · Rate limiter for the export API',   hours: 7.5, notes: 'Token bucket implementation', status: 'Submitted', person: 'Rohit Deshmukh' },
    { date: '29-07-2026', task: 'TSK-0144 · Design review — settings screens',  hours: 5,   notes: 'Review + revisions', status: 'Submitted', person: 'Ayesha Khan' }
  ];


  /* ---- Invoices ---- */
  D.invoices = [
    { no: 'INV-2627-0142', cust: 'Trinetra Systems Pvt Ltd', total: 842000,  paid: 0, wh: 0, settled: 0,      bal: 842000,  status: 'Sent',      due: '02-07-2026', age: '1–30', over: 27, acc: 'Meshrd Current — Chennai' },
    { no: 'INV-2627-0138', cust: 'Aarohi Retail Solutions',  total: 665500,  paid: 200000, wh: 0, settled: 200000, bal: 465500,  status: 'Part-Paid', due: '11-07-2026', age: '1–30', over: 18, acc: 'Meshrd Current — Chennai' },
    { no: 'INV-2627-0131', cust: 'Kaveri Infotech LLP',      total: 1250000, paid: 0, wh: 0, settled: 0,      bal: 1250000, status: 'Sent',      due: '18-07-2026', age: '1–30', over: 11, acc: 'Meshrd Payroll Account' },
    { no: 'INV-2627-0127', cust: 'Nandan Logistics',         total: 187400,  paid: 0, wh: 0, settled: 0,      bal: 187400,  status: 'Sent',      due: '24-07-2026', age: '1–30', over: 5, acc: 'Meshrd Current — Chennai' },
    { no: 'INV-2627-0119', cust: 'Sahyadri Foods Pvt Ltd',   total: 96800,   paid: 0, wh: 0, settled: 0,      bal: 96800,   status: 'Sent',      due: '27-07-2026', age: '1–30', over: 2, acc: 'Meshrd Current — Chennai' },
    /* The customer-withholding worked example, and the whole point of the receivable
   side: Vaayu billed ₹3,25,000, held back ₹32,500 to remit themselves, and paid
   ₹2,92,500. Settled = 2,92,500 + 32,500 = 3,25,000, so the invoice is PAID and
   out of every ageing bucket — even though only ₹2,92,500 ever reached the bank.
   Before 2026-07-31 this invoice would have sat at Part-Paid forever. */
{ no: 'INV-2627-0151', cust: 'Vaayu Media House',        total: 325000,  paid: 292500, wh: 32500, settled: 325000, bal: 0,       status: 'Paid',      due: '10-08-2026', age: 'Current', over: 0, acc: 'Meshrd Payroll Account' },
    { no: 'INV-2627-0149', cust: 'Trinetra Systems Pvt Ltd', total: 1180000, paid: 1180000, wh: 0, settled: 1180000,bal: 0,       status: 'Paid',      due: '05-08-2026', age: 'Current', over: 0, acc: 'Meshrd Current — Chennai' },
    { no: 'INV-2627-0153', cust: 'Pallava Constructions',    total: 268000,  paid: 0, wh: 0, settled: 0,      bal: 268000,  status: 'Draft',     due: '—',          age: 'Current', over: 0, acc: 'Meshrd Current — Chennai' },
    { no: 'INV-2627-0147', cust: 'Kaveri Infotech LLP',      total: 750000,  paid: 750000, wh: 0, settled: 750000, bal: 0,       status: 'Paid',      due: '30-07-2026', age: 'Current', over: 0, acc: 'Meshrd Payroll Account' },
    { no: 'INV-2627-0145', cust: 'Nandan Logistics',         total: 498000,  paid: 498000, wh: 0, settled: 498000, bal: 0,       status: 'Paid',      due: '28-07-2026', age: 'Current', over: 0, acc: 'Meshrd Current — Chennai' }
  ];
  D.invoiceLines = [
    { desc: 'Analytics module — platform licence (annual)', hsn: '998314', unit: 'License', qty: 1, rate: 600000 },
    { desc: 'Custom report pack — 6 reports',               hsn: '998314', unit: 'License', qty: 6, rate: 25000 },
    { desc: 'Implementation support — July 2026',           hsn: '998313', unit: 'Hours',   qty: 1, rate: 92000 }
  ];
  D.payments = [
    { cust: 'Trinetra Systems Pvt Ltd', inv: 'INV-2627-0149', amt: 1180000, mode: 'NEFT',          date: '28-07-2026', ref: 'RCPT-0391' },
    { cust: 'Vaayu Media House',        inv: 'INV-2627-0151', amt: 325000,  mode: 'UPI',           date: '27-07-2026', ref: 'RCPT-0390' },
    { cust: 'Kaveri Infotech LLP',      inv: 'INV-2627-0147', amt: 750000,  mode: 'RTGS',          date: '26-07-2026', ref: 'RCPT-0389' },
    { cust: 'Aarohi Retail Solutions',  inv: 'INV-2627-0138', amt: 200000,  mode: 'Cheque',        date: '24-07-2026', ref: 'RCPT-0388' },
    { cust: 'Nandan Logistics',         inv: 'INV-2627-0145', amt: 498000,  mode: 'Bank Transfer', date: '23-07-2026', ref: 'RCPT-0387' }
  ];
  D.creditNotes = [
    { no: 'CN-2026-0004', inv: 'INV-2627-0149', cust: 'Trinetra Systems Pvt Ltd', reason: 'Billing Error',      amt: 42000, status: 'Pending Approval', by: 'Nisha Kulkarni', appr: '—',            date: '27-07-2026' },
    { no: 'CN-2026-0003', inv: 'INV-2627-0147', cust: 'Kaveri Infotech LLP',      reason: 'Customer Dispute',   amt: 75000, status: 'Approved',         by: 'Nisha Kulkarni', appr: 'Ravi Shankar', date: '18-07-2026' },
    { no: 'CN-2026-0002', inv: 'INV-2627-0145', cust: 'Nandan Logistics',         reason: 'Goods or Service Not Delivered', amt: 18000, status: 'Approved', by: 'Nisha Kulkarni', appr: 'Ravi Shankar', date: '02-07-2026' },
    { no: 'CN-2026-0001', inv: 'INV-2627-0121', cust: 'Sahyadri Foods Pvt Ltd',   reason: 'Billing Error',      amt: 6500,  status: 'Draft',            by: 'Nisha Kulkarni', appr: '—',            date: '28-06-2026' }
  ];

  /* ---- Expenses ---- */
  /* `acc` — the Meshrd account the money moves out of. Blank until the claim is
     actually Reimbursed, which is exactly what the bank-statement export keys on.
     `bill` — the optional Purchase Bill this expense settles, so a claim and the
     supplier's own invoice for the same spend can never be paid twice. */
  D.myExpenses = [
    { type: 'Travel',   kind: 'Reimbursable', vendor: 'Anand Travels',           amt: 8450, date: '26-07-2026', status: 'Pending',    rcpt: 'Yes', acc: '—',                        bill: '—',            desc: 'Client visit — Pune, cab + tolls' },
    { type: 'Software', kind: 'Reimbursable', vendor: 'Chola Technologies',      amt: 1350, date: '25-07-2026', status: 'Approved',   rcpt: 'Yes', acc: 'Meshrd Current — Chennai', bill: 'PB-2026-0031', desc: 'Figma seat — July' },
    { type: 'Meals',    kind: 'Reimbursable', vendor: '—',                       amt: 4820, date: '24-07-2026', status: 'Pending',    rcpt: 'No',  acc: '—',                        bill: '—',            desc: 'Team dinner after the release' },
    { type: 'Travel',   kind: 'Reimbursable', vendor: 'Anand Travels',           amt: 960,  date: '19-07-2026', status: 'Reimbursed', rcpt: 'Yes', acc: 'Meshrd Current — Chennai', bill: '—',            desc: 'Airport drop' },
    { type: 'Stationery', kind: 'Reimbursable', vendor: 'Sundaram Office Supplies', amt: 2340, date: '11-07-2026', status: 'Reimbursed', rcpt: 'Yes', acc: 'Meshrd Current — Chennai', bill: 'PB-2026-0028', desc: 'Notebooks and whiteboard markers' },
    { type: 'Training', kind: 'Reimbursable', vendor: '—',                       amt: 12000,date: '02-07-2026', status: 'Rejected',   rcpt: 'No',  acc: '—',                        bill: '—',            desc: 'Online course — no prior approval' }
  ];
  D.allExpenses = [
    { emp: 'Arun Menon',     type: 'Travel',           kind: 'Reimbursable', vendor: 'Anand Travels',           amt: 8450,  date: '26-07-2026', status: 'Pending',    rcpt: 'Yes', acc: '—',                        bill: '—' },
    { emp: 'Sneha Pillai',   type: 'Software',         kind: 'Reimbursable', vendor: 'Chola Technologies',      amt: 1350,  date: '25-07-2026', status: 'Pending',    rcpt: 'Yes', acc: '—',                        bill: 'PB-2026-0031' },
    { emp: 'Karthik Nair',   type: 'Meals',            kind: 'Reimbursable', vendor: '—',                       amt: 4820,  date: '24-07-2026', status: 'Pending',    rcpt: 'No',  acc: '—',                        bill: '—' },
    { emp: 'Ayesha Khan',    type: 'Travel',           kind: 'Reimbursable', vendor: 'Anand Travels',           amt: 960,   date: '23-07-2026', status: 'Pending',    rcpt: 'Yes', acc: '—',                        bill: '—' },
    { emp: 'Rohit Deshmukh', type: 'Software',         kind: 'Reimbursable', vendor: 'Chola Technologies',      amt: 2400,  date: '20-07-2026', status: 'Approved',   rcpt: 'Yes', acc: 'Meshrd Current — Chennai', bill: '—' },
    { emp: 'Meera Joshi',    type: 'Travel',           kind: 'Reimbursable', vendor: 'Anand Travels',           amt: 18600, date: '18-07-2026', status: 'Approved',   rcpt: 'Yes', acc: 'Meshrd Current — Chennai', bill: '—' },
    { emp: 'Vikram Iyer',    type: 'Stationery',       kind: 'Reimbursable', vendor: 'Sundaram Office Supplies',amt: 2340,  date: '11-07-2026', status: 'Reimbursed', rcpt: 'Yes', acc: 'Meshrd Current — Chennai', bill: 'PB-2026-0028' },
    { emp: 'Fatima Sheikh',  type: 'Recruitment',      kind: 'Reimbursable', vendor: 'Bharat Print House',      amt: 7800,  date: '08-07-2026', status: 'Reimbursed', rcpt: 'Yes', acc: 'Meshrd Current — Chennai', bill: '—' },
    { emp: 'Arun Menon',     type: 'Training',         kind: 'Reimbursable', vendor: '—',                       amt: 12000, date: '02-07-2026', status: 'Rejected',   rcpt: 'No',  acc: '—',                        bill: '—' },
    /* Company-Paid: the company itself was billed. No claimant is owed anything, so
       "Employee" is the Accountant who recorded it, not someone awaiting a payout. */
    { emp: 'Nisha Kulkarni', type: 'Internet / Wi-Fi', kind: 'Company-Paid', vendor: 'Chola Technologies',      amt: 9440,  date: '05-07-2026', status: 'Reimbursed', rcpt: 'Yes', acc: 'Meshrd Current — Chennai', bill: 'PB-2026-0030' },
    { emp: 'Nisha Kulkarni', type: 'Office Rent',      kind: 'Company-Paid', vendor: 'Gokul Facility Services', amt: 185000,date: '03-07-2026', status: 'Reimbursed', rcpt: 'Yes', acc: 'Meshrd Current — Chennai', bill: 'PB-2026-0022' },
    { emp: 'Nisha Kulkarni', type: 'Cloud Hosting',    kind: 'Company-Paid', vendor: 'Zenith IT Distributors',  amt: 62800, date: '02-07-2026', status: 'Approved',   rcpt: 'Yes', acc: 'Meshrd Current — Chennai', bill: '—' },
    { emp: 'Nisha Kulkarni', type: 'Electricity',      kind: 'Company-Paid', vendor: '—',                       amt: 21350, date: '01-07-2026', status: 'Pending',    rcpt: 'Yes', acc: '—',                        bill: '—' }
  ];

  /* ---- Vendors ---- */
  D.vendors = [
    /* `bname` is the name ON the account — who the money is actually paid to. It is
       what a person recognises and checks before releasing a payment; `bacc` (the
       masked number) only confirms which of that party's accounts. A name that does
       not match the vendor is the single clearest sign something is wrong, which is
       why the name, not the number, is the column shown on the directory. */
    { name: 'Sundaram Office Supplies', gstin: '33AABCS1122L1Z7', phone: '98411 30001', email: 'accounts@sundaramoffice.in', terms: '30 days', status: 'Active',   city: 'Chennai',    bank: 'Yes', bname: 'Sundaram Office Supplies',        bbank: 'HDFC Bank', bacc: 'HDFC ••••3310',  out: 0 },
    { name: 'Chola Technologies',       gstin: '33AACCC3344M1Z4', phone: '98411 30002', email: 'billing@cholatech.in',       terms: '15 days', status: 'Active',   city: 'Chennai',    bank: 'Yes', bname: 'Chola Technologies Pvt Ltd',      bbank: 'HDFC Bank', bacc: 'HDFC ••••2201',  out: 184000 },
    { name: 'Gokul Facility Services',  gstin: '33AADCG5566N1Z1', phone: '98411 30003', email: 'gokul.fs@gmail.com',         terms: '30 days', status: 'Active',   city: 'Chennai',    bank: 'Yes', bname: 'Gokul Facility Services LLP',     bbank: 'State Bank of India', bacc: 'SBI ••••8842',   out: 96000 },
    { name: 'Anand Travels',            gstin: '33AAECA7788P1Z8', phone: '98411 30004', email: 'bookings@anandtravels.in',   terms: '7 days',  status: 'Active',   city: 'Coimbatore', bank: 'No',  bname: '—',                               bbank: '—',         bacc: '—',              out: 0 },
    { name: 'Bharat Print House',       gstin: '—',               phone: '98411 30005', email: 'bharatprint@outlook.com',    terms: '30 days', status: 'Active',   city: 'Chennai',    bank: 'No',  bname: '—',                               bbank: '—',         bacc: '—',              out: 24000 },
    { name: 'Zenith IT Distributors',   gstin: '29AAFCZ9900Q1Z5', phone: '98411 30006', email: 'sales@zenithit.in',          terms: '45 days', status: 'Inactive', city: 'Bengaluru',  bank: 'Yes', bname: 'Zenith IT Distributors Pvt Ltd',  bbank: 'Axis Bank', bacc: 'Axis ••••5567',  out: 0 }
  ];
  /* `acc` = the Meshrd account the money actually left from, `vacc` = the vendor's
     own account it landed in. Both stay '—' while nothing has been paid — that is
     the point of showing them: an unpaid row has no account, a paid row must. */
  D.vendorUsage = [
    /* Gross bill figure, deliberately — Vendor Usage is about what a supplier was
       billed, not what net cash reached them after withholding. Matches D.bills. */
    { type: 'Purchase Bill', ref: 'PB-2026-0031', date: '24-07-2026', amt: 184080, status: 'Unpaid',   acc: '—',                          vacc: 'Chola Technologies Pvt Ltd', vaccno: 'HDFC ••••2201', mode: '—' },
    { type: 'Purchase Bill', ref: 'PB-2026-0022', date: '18-06-2026', amt: 96000,  status: 'Paid',     acc: 'Meshrd Current — Chennai',   vacc: 'Chola Technologies Pvt Ltd', vaccno: 'HDFC ••••2201', mode: 'NEFT' },
    { type: 'Expense',       ref: 'EXP-00184',    date: '25-07-2026', amt: 1350,   status: 'Approved', acc: 'Meshrd Current — Chennai',   vacc: 'Chola Technologies Pvt Ltd', vaccno: 'ICICI ••••7754', mode: 'UPI' },
    { type: 'Expense',       ref: 'EXP-00171',    date: '20-07-2026', amt: 2400,   status: 'Approved', acc: 'Meshrd Current — Chennai',   vacc: 'Chola Technologies Pvt Ltd', vaccno: 'ICICI ••••7754', mode: 'UPI' },
    { type: 'Purchase Bill', ref: 'PB-2026-0014', date: '02-05-2026', amt: 212000, status: 'Paid',     acc: 'Meshrd Payroll Account',     vacc: 'Chola Technologies Pvt Ltd', vaccno: 'HDFC ••••2201', mode: 'RTGS' }
  ];

  /* ---- Tax & Compliance (Module 13 §8) — added 2026-07-31 ----
     Two registers that are NEVER netted against each other: what the company
     withheld from suppliers is a LIABILITY owed onward to an authority; what
     customers withheld from the company is an ASSET claimable back. A single
     "net tax position" figure would be wrong in both directions. */

  /* Payable: one row per Tax Head x Remittance Period. Outstanding = withheld - remitted. */
  D.taxPeriods = [
    /* Vendor-sourced. Calendar-aligned. */
    { head: 'Withholding — Professional Fees',   src: 'Vendor',   authority: 'Income Tax Department',    label: 'Jul 2026', from: '01-07-2026', to: '31-07-2026', docs: 2, withheld: 19750, remitted: 0,     due: '07-08-2026', status: 'Due Soon', ref: '—' },
    { head: 'Withholding — Contractor Payments', src: 'Vendor',   authority: 'Income Tax Department',    label: 'Jul 2026', from: '01-07-2026', to: '31-07-2026', docs: 1, withheld: 372,   remitted: 0,     due: '07-08-2026', status: 'Due Soon', ref: '—' },
    { head: 'Withholding — Professional Fees',   src: 'Vendor',   authority: 'Income Tax Department',    label: 'Jun 2026', from: '01-06-2026', to: '30-06-2026', docs: 1, withheld: 4150,  remitted: 4150,  due: '07-07-2026', status: 'Remitted', ref: 'CHLN-2026-00841' },
    { head: 'Withholding — Contractor Payments', src: 'Vendor',   authority: 'Income Tax Department',    label: 'Jun 2026', from: '01-06-2026', to: '30-06-2026', docs: 1, withheld: 2600,  remitted: 1600,  due: '07-07-2026', status: 'Overdue',  ref: 'CHLN-2026-00842' },
    /* Payroll-sourced — PAY CYCLE aligned (26th–25th), NOT calendar months. A payroll
       obligation period aligned to calendar months would disagree with the payslips
       that produced it, which is why Period Aligns To exists on the head. */
    { head: 'Income Tax (TDS)',                  src: 'Employee', authority: 'Income Tax Department',    label: 'Jul 2026', from: '26-06-2026', to: '25-07-2026', docs: 14, withheld: 186400, remitted: 0,      due: '01-08-2026', status: 'Due Soon', ref: '—' },
    { head: 'PF — Employee (12%)',               src: 'Employee', authority: 'EPFO',                     label: 'Jul 2026', from: '26-06-2026', to: '25-07-2026', docs: 14, withheld: 92880,  remitted: 0,      due: '09-08-2026', status: 'Open',     ref: '—' },
    { head: 'PF — Employer (12%)',               src: 'Employee', authority: 'EPFO',                     label: 'Jul 2026', from: '26-06-2026', to: '25-07-2026', docs: 14, withheld: 92880,  remitted: 0,      due: '09-08-2026', status: 'Open',     ref: '—' },
    { head: 'Professional Tax',                  src: 'Employee', authority: 'State Commercial Taxes',   label: 'Jul 2026', from: '26-06-2026', to: '25-07-2026', docs: 14, withheld: 2912,   remitted: 0,      due: '14-08-2026', status: 'Open',     ref: '—' },
    { head: 'Income Tax (TDS)',                  src: 'Employee', authority: 'Income Tax Department',    label: 'Jun 2026', from: '26-05-2026', to: '25-06-2026', docs: 13, withheld: 178200, remitted: 178200, due: '01-07-2026', status: 'Remitted', ref: 'CHLN-2026-00810' },
    { head: 'PF — Employee (12%)',               src: 'Employee', authority: 'EPFO',                     label: 'Jun 2026', from: '26-05-2026', to: '25-06-2026', docs: 13, withheld: 88400,  remitted: 88400,  due: '09-07-2026', status: 'Remitted', ref: 'ECR-2026-3391' }
  ];
  D.taxPeriods.forEach(p => { p.outstanding = p.withheld - p.remitted; });

  /* Payable drill-down: one row per bill carrying withholding. */
  D.taxWithheldDocs = [
    { doc: 'PB-2026-0031', src: 'Vendor',   party: 'Chola Technologies',       date: '24-07-2026', head: 'Withholding — Professional Fees',   base: 'Subtotal', total: 184080, withheld: 15600, net: 168480, period: 'Jul 2026', rstatus: 'Not Remitted', ref: '—' },
    { doc: 'PB-2026-0026', src: 'Vendor',   party: 'Anand Travels',            date: '22-06-2026', head: 'Withholding — Contractor Payments', base: 'Total',    total: 18600,  withheld: 372,   net: 18228,  period: 'Jul 2026', rstatus: 'Not Remitted', ref: '—' },
    { doc: 'PB-2026-0028', src: 'Vendor',   party: 'Sundaram Office Supplies', date: '10-07-2026', head: 'Withholding — Professional Fees',   base: 'Total',    total: 41500,  withheld: 4150,  net: 37350,  period: 'Jun 2026', rstatus: 'Remitted',     ref: 'CHLN-2026-00841' },
    /* Payroll-sourced rows. The "document" is a payslip, the counterparty an
       employee, and the money is owed to the same authorities as the vendor rows —
       which is exactly why one register carries all three sources. */
    { doc: 'PSL-2026-07-0001', src: 'Employee', party: 'Arun Menon',    date: '25-07-2026', head: 'Income Tax (TDS)',      base: 'Taxable Pay', total: 84150, withheld: 13940, net: 70210, period: 'Jul 2026', rstatus: 'Not Remitted', ref: '—' },
    { doc: 'PSL-2026-07-0002', src: 'Employee', party: 'Sneha Pillai',  date: '25-07-2026', head: 'Income Tax (TDS)',      base: 'Taxable Pay', total: 76300, withheld: 11480, net: 64820, period: 'Jul 2026', rstatus: 'Not Remitted', ref: '—' },
    { doc: 'PSL-2026-07-0001', src: 'Employee', party: 'Arun Menon',    date: '25-07-2026', head: 'PF — Employee (12%)',   base: 'Basic',       total: 32000, withheld: 3840,  net: 28160, period: 'Jul 2026', rstatus: 'Not Remitted', ref: '—' },
    { doc: 'PSL-2026-07-0001', src: 'Employee', party: 'Arun Menon',    date: '25-07-2026', head: 'Professional Tax',      base: 'Gross',       total: 84150, withheld: 208,   net: 83942, period: 'Jul 2026', rstatus: 'Not Remitted', ref: '—' }
  ];

  /* Payable: one row per remittance actually handed to the authority. */
  D.taxRemittances = [
    { id: 'RMT-2026-0007', head: 'Withholding — Professional Fees',   period: 'Jun 2026', amt: 4150,  on: '05-07-2026', from: 'Meshrd Current — Chennai', mode: 'NEFT', ref: 'CHLN-2026-00841', docs: 1, by: 'Nisha Kulkarni' , authority: 'Income Tax Department' },
    { id: 'RMT-2026-0006', head: 'Withholding — Contractor Payments', period: 'Jun 2026', amt: 1600,  on: '05-07-2026', from: 'Meshrd Current — Chennai', mode: 'NEFT', ref: 'CHLN-2026-00842', docs: 1, by: 'Nisha Kulkarni' , authority: 'Income Tax Department' },
    { id: 'RMT-2026-0005', head: 'Withholding — Professional Fees',   period: 'May 2026', amt: 11200, on: '04-06-2026', from: 'Meshrd Current — Chennai', mode: 'RTGS', ref: 'CHLN-2026-00790', docs: 3, by: 'Nisha Kulkarni' , authority: 'Income Tax Department' }
  ];

  /* Receivable: one row per invoice receipt a customer withheld from.
     `certdue` = certificate expected but not yet received. */
  D.taxReceipts = [
    { inv: 'INV-2627-0151', cust: 'Vaayu Media House',      date: '28-07-2026', head: 'Withholding — Customer Deductions', base: 'Subtotal', total: 325000, received: 292500, withheld: 32500, cert: 'No',  certref: '—',              certdate: '—',          claimed: 'No', status: 'Awaiting Certificate' },
    { inv: 'INV-2627-0149', cust: 'Trinetra Systems Pvt Ltd', date: '02-07-2026', head: 'Withholding — Customer Deductions', base: 'Subtotal', total: 1180000, received: 1062000, withheld: 118000, cert: 'Yes', certref: 'CERT-TRN-4471', certdate: '18-07-2026', claimed: 'No', status: 'Certified — Unclaimed' },
    { inv: 'INV-2627-0147', cust: 'Kaveri Infotech LLP',    date: '20-06-2026', head: 'Withholding — Customer Deductions', base: 'Subtotal', total: 750000, received: 675000, withheld: 75000, cert: 'Yes', certref: 'CERT-KAV-2210', certdate: '30-06-2026', claimed: 'Yes', status: 'Claimed' }
  ];

  /* Receivable: one row per certificate logged. Variance = certificate says a
     different figure than the receipts it covers — the certified amount wins. */
  D.taxCertificates = [
    { ref: 'CERT-TRN-4471', cust: 'Trinetra Systems Pvt Ltd', cdate: '18-07-2026', from: '01-04-2026', to: '30-06-2026', head: 'Withholding — Customer Deductions', stated: 118000, matched: 118000, variance: 0,    receipts: 1, status: 'Matched',  by: 'Nisha Kulkarni' },
    { ref: 'CERT-KAV-2210', cust: 'Kaveri Infotech LLP',      cdate: '30-06-2026', from: '01-04-2026', to: '30-06-2026', head: 'Withholding — Customer Deductions', stated: 74500,  matched: 75000,  variance: -500, receipts: 1, status: 'Variance', by: 'Nisha Kulkarni' }
  ];

  /* ---- Purchase Bills ---- */
  D.bills = [
    /* `wh` = amount withheld from what the vendor is paid (0 when none applies).
       `net` = Total − wh = Amount Payable to Vendor, the ceiling for payments and
       the figure that actually leaves the bank. A bill is Paid when paid + wh
       reaches total — PB-2026-0028 below is the worked case: ₹41,500 billed,
       ₹4,150 withheld, ₹37,350 paid, and the vendor is owed nothing further. */
    /* PB-2026-0031 is the bill the Add/Edit screen stands in for, so its figures are
       kept in exact agreement with that screen's line items: 12 × ₹12,000 + ₹12,000
       = ₹1,56,000 subtotal, +18% tax = ₹1,84,080 total. Withholding is 10% of the
       SUBTOTAL (₹15,600), matching the spec's "Calculated On: Subtotal" default —
       not 10% of the total, which would silently overstate what is held back. */
    { id: 'PB-2026-0031', vendor: 'Chola Technologies',      vno: 'CT/26-27/0912', total: 184080, wh: 15600, net: 168480, paid: 0,      status: 'Unpaid',    bdate: '24-07-2026', due: '08-08-2026', acc: 'Meshrd Current — Chennai', whtax: 'Withholding — Professional Fees' },
    { id: 'PB-2026-0030', vendor: 'Gokul Facility Services', vno: 'GFS-2026-441',  total: 96000,  wh: 0,     net: 96000,  paid: 40000,  status: 'Part-Paid', bdate: '20-07-2026', due: '19-08-2026', acc: 'Meshrd Current — Chennai', whtax: '—' },
    { id: 'PB-2026-0029', vendor: 'Bharat Print House',      vno: 'BPH/1287',      total: 24000,  wh: 0,     net: 24000,  paid: 0,      status: 'Unpaid',    bdate: '18-07-2026', due: '17-08-2026', acc: 'Meshrd Payroll Account',   whtax: '—' },
    { id: 'PB-2026-0028', vendor: 'Sundaram Office Supplies',vno: 'SOS-26-3341',   total: 41500,  wh: 4150,  net: 37350,  paid: 37350,  status: 'Paid',      bdate: '10-07-2026', due: '09-08-2026', acc: 'Meshrd Current — Chennai', whtax: 'Withholding — Professional Fees' },
    { id: 'PB-2026-0027', vendor: 'Zenith IT Distributors',  vno: 'ZID/2026/0455', total: 386000, wh: 0,     net: 386000, paid: 386000, status: 'Paid',      bdate: '28-06-2026', due: '12-08-2026', acc: 'Meshrd Current — Chennai', whtax: '—' },
    { id: 'PB-2026-0026', vendor: 'Anand Travels',           vno: 'AT-7781',       total: 18600,  wh: 372,   net: 18228,  paid: 18228,  status: 'Paid',      bdate: '22-06-2026', due: '29-06-2026', acc: 'Meshrd Payroll Account',   whtax: 'Withholding — Contractor Payments' }
  ];

  /* ---- Documents ---- */
  /* Super Admin's own documents — all auto-verified on upload (no HR approval needed for SA) */
  D.myDocs = [
    { type: 'ID Proof',                file: 'aadhaar-front-back.pdf',    up: '12-09-2022', status: 'Verified', rej: '—' },
    { type: 'ID Proof',                file: 'pan-card.jpg',              up: '12-09-2022', status: 'Verified', rej: '—' },
    { type: 'Educational Certificate', file: 'be-degree-certificate.pdf', up: '12-09-2022', status: 'Verified', rej: '—' },
    { type: 'Educational Certificate', file: 'consolidated-marksheet.pdf',up: '27-07-2026', status: 'Verified', rej: '—' },
    { type: 'Resume',                  file: 'rajesh-sa-cv-2026.pdf',     up: '20-07-2026', status: 'Verified', rej: '—' },
    { type: 'Others',                  file: 'address-proof.pdf',         up: '05-06-2026', status: 'Verified', rej: '—' }
  ];
  D.docQueue = [
    { emp: 'Arun Menon',    dept: 'Engineering',     type: 'Educational Certificate', up: '27-07-2026', wait: 2 },
    { emp: 'Arun Menon',    dept: 'Engineering',     type: 'Resume',                  up: '20-07-2026', wait: 9 },
    { emp: 'Divya Raman',   dept: 'Sales',           type: 'ID Proof',                up: '28-07-2026', wait: 1 },
    { emp: 'Divya Raman',   dept: 'Sales',           type: 'Offer Letter Copy',       up: '28-07-2026', wait: 1 },
    { emp: 'Imran Qureshi', dept: 'Engineering',     type: 'ID Proof',                up: '24-07-2026', wait: 5 },
    { emp: 'Imran Qureshi', dept: 'Engineering',     type: 'Educational Certificate', up: '24-07-2026', wait: 5 }
  ];

  /* ---- Onboarding / Exit ---- */
  D.onboardingQueue = [
    { emp: 'Divya Raman',   join: '27-07-2026', dept: 'Sales',       done: '4 of 7', stuck: 'Assign starter assets', days: 2 },
    { emp: 'Imran Qureshi', join: '23-07-2026', dept: 'Engineering', done: '6 of 7', stuck: 'Send welcome email',    days: 6 },
    { emp: 'Anjali Verma',  join: '03-08-2026', dept: 'Support',     done: '1 of 7', stuck: 'Create login',          days: -5 }
  ];
  D.exitQueue = [
    { emp: 'Suresh Babu', lwd: '12-08-2026', dept: 'Operations', ack: 'Yes', done: '1 of 4', assets: 3, settle: 'Pending' },
    { emp: 'Priya Varma', lwd: '30-06-2026', dept: 'Design',     ack: 'Yes', done: '4 of 4', assets: 0, settle: 'Paid' }
  ];
  D.onboardingSteps = [
    { t: 'Create Employee Master record',  d: 'Personal Details + Employment Details filled in and saved. Auto-checks on save.', done: 1 },
    { t: 'Create login (optional)',        d: 'Create Login toggled on in Account & Login. A temporary password is emailed automatically.', done: 1 },
    { t: 'Assign a Reporting Manager',     d: 'Set on Employment Details — currently Meera Joshi.', done: 1 },
    { t: 'Set up this year\'s leave balance', d: 'Automatic. Prorated from the Joining Date: (Annual Quota ÷ 12) × months remaining.', done: 1 },
    { t: 'Link a Salary Structure',        d: 'Set on the Salary Structure tab, or flagged for Payroll to complete.', done: 0 },
    { t: 'Assign starter assets',          d: 'Done inside Asset Management. Auto-checks once an assignment is confirmed.', done: 0 },
    { t: 'Send welcome email',             d: 'Notifies the new joiner with a checklist pointing at My Documents.', done: 0 }
  ];
  /* Exit checklist. The order is the rule, not a suggestion: the resignation
     letter is generated first, and only then does asset return open — the letter
     is what fixes the Last Working Day every subsequent step counts back from.
     `gate` names the step that must be Done before this one can be actioned. */
  D.exitSteps = [
    { t: 'Generate resignation acceptance letter', d: 'HR generates the letter once the Reporting Manager has acknowledged the resignation. It fixes the Last Working Day, and nothing below can start until it exists.', done: 0, go: 'emp.letter' },
    { t: 'Return all assigned assets',  d: '3 assets still assigned. Every one must show Returned or Retired — no exception, no partial exit. Auto-checks when the last one is cleared in Asset Management.', done: 0, gate: 'Generate resignation acceptance letter', go: 'asset.reclaim' },
    { t: 'Mark final settlement due',   d: 'Records that a final settlement is owed; the calculation happens in Payroll and Expense. Held until every asset is back, so an unreturned laptop can still be recovered from the settlement.', done: 0, gate: 'Return all assigned assets' },
    { t: 'Disable login',               d: 'Toggles Account Status off on the Account & Login tab. Confirm-before-you-go.', done: 0, gate: 'Return all assigned assets' },
    { t: 'Change status to Exited',     d: 'Sets Status to Exited and records an Exit Date, defaulting to the Last Working Day on the letter.', done: 0, gate: 'Return all assigned assets' }
  ];

  /* ---- Notifications ---- */
  D.activity = [
    { ico: 'check',   tone: 'var(--success)', bg: 'var(--success-bg)',   t: 'Leave approved — <b>Casual Leave, 1 day</b>', m: 'Vikram Iyer · 28 Jul, 4:12 PM' },
    { ico: 'payroll', tone: 'var(--accent)',  bg: 'var(--accent-subtle)',t: 'New payslip available — <b>June 2026</b>',    m: 'Payroll · 01 Jul, 9:00 AM' },
    { ico: 'doc',     tone: 'var(--info)',    bg: 'var(--info-bg)',      t: 'Document verified — <b>PAN Card</b>',          m: 'Fatima Sheikh · 27 Jul, 11:36 AM' },
    { ico: 'asset',   tone: 'var(--warning)', bg: 'var(--warning-bg)',   t: 'Asset request approved — <b>Dell Latitude 5440</b>', m: 'Vikram Iyer · 24 Jul, 2:05 PM' },
    { ico: 'ticket',  tone: 'var(--danger)',  bg: 'var(--danger-bg)',    t: 'Ticket assigned to you — <b>TKT-2026-0912</b>', m: 'Support · 23 Jul, 10:18 AM' }
  ];
  D.announcements = [
    { t: 'Independence Day — office closed 15 Aug',                m: 'HR · Posted 26 Jul · All Employees', pin: 1 },
    { t: 'FY 2026–27 tax declaration window is open till 31 Aug',  m: 'Accounts · Posted 22 Jul · All Employees' },
    { t: 'New medical insurance plan enrolment — action needed',   m: 'HR · Posted 18 Jul · All Employees' },
    { t: 'Quarterly all-hands — 05 Aug, 4:00 PM, Chennai office',  m: 'Operations · Posted 15 Jul · All Employees' }
  ];
  D.notifs = [
    { ico: 'check',   tone: 'var(--success)', bg: 'var(--success-bg)',    t: 'Your leave request was <b>approved</b>', m: '2 hours ago', u: 1 },
    { ico: 'ticket',  tone: 'var(--danger)',  bg: 'var(--danger-bg)',     t: 'Ticket <b>TKT-2026-0912</b> assigned to you', m: '5 hours ago', u: 1 },
    { ico: 'clock',   tone: 'var(--warning)', bg: 'var(--warning-bg)',    t: 'Task <b>TSK-0142</b> is due tomorrow', m: 'Yesterday', u: 1 },
    { ico: 'payroll', tone: 'var(--accent)',  bg: 'var(--accent-subtle)', t: 'Payslip for <b>June 2026</b> is available', m: '2 days ago', u: 1 },
    { ico: 'doc',     tone: 'var(--info)',    bg: 'var(--info-bg)',       t: 'Document <b>PAN Card</b> verified', m: '3 days ago', u: 1 },
    { ico: 'asset',   tone: 'var(--warning)', bg: 'var(--warning-bg)',    t: 'Asset request <b>approved</b> — Dell Latitude 5440', m: '5 days ago' }
  ];

  /* ---- Masters ---- */
  D.masters = {
    fy:            [{ name: 'FY 2026–27', from: '01-04-2026', to: '31-03-2027', status: 'Active', locked: 'No' },
                    { name: 'FY 2025–26', from: '01-04-2025', to: '31-03-2026', status: 'Inactive', locked: 'Yes' },
                    { name: 'FY 2024–25', from: '01-04-2024', to: '31-03-2025', status: 'Inactive', locked: 'Yes' }],
    taxHeads:      [
                    /* ── Billing taxes (appear in Invoice & Quote dropdowns) ── */
                    { name: 'GST 18% — CGST + SGST', type: 'GST — CGST+SGST', cgst: '9%', sgst: '9%', rate: '18%', scope: 'Sales / Billing', force: 'In Force', from: '01-04-2026' },
                    { name: 'GST 18% — IGST',         type: 'GST — IGST',       rate: '18%', scope: 'Sales / Billing', force: 'In Force', from: '01-04-2026' },
                    { name: 'GST 12% — CGST + SGST', type: 'GST — CGST+SGST', cgst: '6%', sgst: '6%', rate: '12%', scope: 'Sales / Billing', force: 'In Force', from: '01-04-2026' },
                    { name: 'GST 12% — IGST',         type: 'GST — IGST',       rate: '12%', scope: 'Sales / Billing', force: 'In Force', from: '01-04-2026' },
                    { name: 'GST 5% — CGST + SGST',  type: 'GST — CGST+SGST', cgst: '2.5%', sgst: '2.5%', rate: '5%', scope: 'Sales / Billing', force: 'In Force', from: '01-04-2026' },
                    /* ── Purchase taxes ── */
                    { name: 'Input GST 18% — IGST',   type: 'GST — IGST',       rate: '18%', scope: 'Purchase', force: 'In Force', from: '01-04-2026' },
                    { name: 'Input GST 18% — CGST+SGST', type: 'GST — CGST+SGST', cgst: '9%', sgst: '9%', rate: '18%', scope: 'Purchase', force: 'In Force', from: '01-04-2026' },
                    /* Withholding scope — confirmed in use 2026-07-31. Unlike every head above,
                       this one is DEDUCTED from what the vendor is paid rather than added to the
                       bill: it reduces Amount Payable to Vendor and is remitted to the authority
                       instead. See 13-purchase-bill-module.md §2.2. */
                    /* ONE withholding scope; direction is a field on the head, not a
                       separate scope. `onward:'Yes'` is the gate that puts a head into
                       the Tax & Compliance register (Module 15) — and it is available on
                       ANY scope, which is how the payroll heads below join the same
                       register without duplicating any of this machinery. */
                    { name: 'Withholding — Contractor Payments', type: 'Percentage', rate: '2%',  scope: 'Withholding / Deduction at Source', force: 'In Force', from: '01-04-2026', onward: 'Yes', authority: 'Income Tax Department', period: 'Monthly',   aligns: 'Calendar',    dueDays: 7,  anchor: 'Payment Date',        dir: 'On Payments Made',                       cert: 'No',  refLabel: 'Challan Number' },
                    { name: 'Withholding — Professional Fees',   type: 'Percentage', rate: '10%', scope: 'Withholding / Deduction at Source', force: 'In Force', from: '01-04-2026', onward: 'Yes', authority: 'Income Tax Department', period: 'Monthly',   aligns: 'Calendar',    dueDays: 7,  anchor: 'Payment Date',        dir: 'On Payments Made, On Payments Received', cert: 'Yes', refLabel: 'Challan Number' },
                    { name: 'Withholding — Customer Deductions', type: 'Percentage', rate: '10%', scope: 'Withholding / Deduction at Source', force: 'In Force', from: '01-04-2026', onward: 'Yes', authority: 'Income Tax Department', period: 'Quarterly', aligns: 'Financial Year', dueDays: 15, anchor: 'Payment Date',        dir: 'On Payments Received',                   cert: 'Yes', refLabel: 'Certificate Number' },
                    /* ── Payroll taxes ── */
                    { name: 'PF — Employee (12%)',     type: 'Percentage',        rate: '12%', scope: 'Payroll — Employee Deduction',    force: 'In Force', from: '01-04-2026' , onward: 'Yes', authority: 'EPFO', period: 'Monthly', aligns: 'Pay Cycle', dueDays: 15, refLabel: 'ECR Challan Number' },
                    { name: 'PF — Employer (12%)',     type: 'Percentage',        rate: '12%', scope: 'Payroll — Employer Contribution',  force: 'In Force', from: '01-04-2026' , onward: 'Yes', authority: 'EPFO', period: 'Monthly', aligns: 'Pay Cycle', dueDays: 15, refLabel: 'ECR Challan Number' },
                    { name: 'Professional Tax',        type: 'Slab',              rate: '4 bands', scope: 'Payroll — Employee Deduction', force: 'In Force', from: '01-04-2026' , onward: 'Yes', authority: 'State Commercial Taxes', period: 'Monthly', aligns: 'Pay Cycle', dueDays: 20, refLabel: 'Challan Number' },
                    { name: 'Income Tax (TDS)',         type: 'Slab',              rate: '5 bands', scope: 'Payroll — Income Tax',         force: 'In Force', from: '01-04-2026' , onward: 'Yes', authority: 'Income Tax Department', period: 'Monthly', aligns: 'Pay Cycle', dueDays: 7, refLabel: 'Challan Number' },
                    { name: 'Section 80C Deduction',   type: 'Declaration Cap',   rate: 'Cap ₹1,50,000', scope: 'Employee Declaration / Exemption', force: 'In Force', from: '01-04-2026' }],
    taxSchemes:    [{ name: 'Standard Scheme', def: 'Yes', desc: 'Allows every configured declaration head. Default for all employees.', window: 'April only', heads: 4 },
                    { name: 'Simplified Scheme', def: 'No', desc: 'Lower slab rates, no declaration heads permitted.', window: 'April only', heads: 0 }],
    /* `kind` is what makes an expense type usable by the right person:
       Reimbursable — an employee paid out of pocket and gets the money back.
       Company-Paid — the company was billed directly and simply settles it; nobody
                      is owed anything, so these never enter the reimbursement queue
                      and only Super Admin / Accountant may raise them.
       `recur` marks the standing bills (Wi-Fi, rent, hosting) that arrive every
       month, so Accounts can filter down to what is expected rather than one-off. */
    expenseTypes:  [{ name: 'Travel',               code: 'TRV',  kind: 'Reimbursable', recur: 'No',  status: 'Active',   used: 'Yes' },
                    { name: 'Meals',                code: 'MEA',  kind: 'Reimbursable', recur: 'No',  status: 'Active',   used: 'Yes' },
                    { name: 'Software',             code: 'SFT',  kind: 'Reimbursable', recur: 'No',  status: 'Active',   used: 'Yes' },
                    { name: 'Stationery',           code: 'STN',  kind: 'Reimbursable', recur: 'No',  status: 'Active',   used: 'Yes' },
                    { name: 'Training',             code: 'TRN',  kind: 'Reimbursable', recur: 'No',  status: 'Active',   used: 'Yes' },
                    { name: 'Recruitment',          code: 'RCT',  kind: 'Reimbursable', recur: 'No',  status: 'Active',   used: 'Yes' },
                    { name: 'Internet / Wi-Fi',     code: 'NET',  kind: 'Company-Paid', recur: 'Yes', status: 'Active',   used: 'Yes' },
                    { name: 'Electricity',          code: 'ELE',  kind: 'Company-Paid', recur: 'Yes', status: 'Active',   used: 'Yes' },
                    { name: 'Office Rent',          code: 'RNT',  kind: 'Company-Paid', recur: 'Yes', status: 'Active',   used: 'Yes' },
                    { name: 'Telephone / Mobile',   code: 'TEL',  kind: 'Company-Paid', recur: 'Yes', status: 'Active',   used: 'Yes' },
                    { name: 'Cloud Hosting',        code: 'CLD',  kind: 'Company-Paid', recur: 'Yes', status: 'Active',   used: 'Yes' },
                    { name: 'Housekeeping',         code: 'HKP',  kind: 'Company-Paid', recur: 'Yes', status: 'Active',   used: 'No' },
                    { name: 'Client Entertainment', code: 'CLE',  kind: 'Reimbursable', recur: 'No',  status: 'Inactive', used: 'No' }],
    workWeek:      [{ name: 'Standard — 40 Hour Week',   applies: 'Company-wide (default)',        gross: 9, brk: 1,   net: 8,   weekly: 40,   weekoff: 'Sunday',            satrule: 'Odd Saturdays Working (1st, 3rd, 5th)', sathrs: 8, comp: 'Yes', window: 30, shortfall: 'Pro-rata per hour', status: 'Active',   used: 'Yes' },
                    { name: 'Support — Rotational Shift', applies: 'Department — Support',           gross: 9, brk: 1,   net: 8,   weekly: 48,   weekoff: 'Rotational — 1 day/week', satrule: 'All Saturdays Working',            sathrs: 8, comp: 'Yes', window: 30, shortfall: 'Pro-rata per hour', status: 'Active',   used: 'Yes' },
                    { name: 'Intern — Half Day',          applies: 'Employment Type — Intern',       gross: 5, brk: 0.5, net: 4.5, weekly: 22.5, weekoff: 'Saturday, Sunday',  satrule: 'All Saturdays Off',                sathrs: 0, comp: 'No',  window: 0,  shortfall: 'Ignore',            status: 'Active',   used: 'Yes' },
                    { name: 'Contract — 6 Day Week',       applies: 'Employment Type — Contract',     gross: 9, brk: 1,   net: 8,   weekly: 48,   weekoff: 'Sunday',            satrule: 'All Saturdays Working',            sathrs: 8, comp: 'No',  window: 0,  shortfall: 'Per day',           status: 'Inactive', used: 'No' }],
    hourRules:     [{ status: 'Full Day',         min: '8.00 h', max: '—',      pay: '1.00 day', ded: 'None',                note: 'Net hours met in full.' },
                    { status: 'Full Day — grace', min: '7.75 h', max: '7.99 h', pay: '1.00 day', ded: 'None',                note: 'Inside the 15-minute grace window configured on the policy.' },
                    { status: 'Half Day',         min: '4.00 h', max: '7.74 h', pay: '0.50 day', ded: 'Half day, unless compensated', note: 'The shortfall can be made up on a day of the employee’s choice.' },
                    { status: 'Absent',           min: '0.00 h', max: '3.99 h', pay: '0.00 day', ded: 'Full day (Loss of Pay)', note: 'Unless an approved leave covers the date.' }],
    /* Pay Cycle — the window a payroll run actually covers. Fully dynamic: Start Day and
       End Day are editable fields, not a hard-coded 26th/25th. Whatever they're set to,
       an event dated after End Day always falls into the NEXT period, never the one
       that just closed — that reconciliation rule is the reason this exists. */
    payrollCycle:  { mode: 'Fixed Cycle — Custom Start/End Day', startDay: 26, endDay: 25, creditDay: 30, status: 'Active',
                     note: 'Runs from the 26th of the previous month to the 25th of the current month. An event dated the 26th or later belongs to next month\'s run. Salary is credited on the 30th of the month a period is named for — 5 days after the cutoff, to leave room for the run to actually be calculated and confirmed.' },
    leaveTypes:    [{ name: 'Casual Leave', code: 'CL', quota: 12, cf: 'No',  maxcf: 0, status: 'Active', used: 'Yes' },
                    { name: 'Sick Leave',   code: 'SL', quota: 8,  cf: 'No',  maxcf: 0, status: 'Active', used: 'Yes' },
                    { name: 'Earned Leave', code: 'EL', quota: 15, cf: 'Yes', maxcf: 30, status: 'Active', used: 'Yes' },
                    { name: 'Comp Off',     code: 'CO', quota: 2,  cf: 'No',  maxcf: 0, status: 'Active', used: 'Yes' },
                    { name: 'Work From Home', code: 'WFH', quota: 0, cf: 'No', maxcf: 0, status: 'Active', used: 'Yes' },
                    { name: 'Maternity Leave', code: 'ML', quota: 182, cf: 'No', maxcf: 0, status: 'Active', used: 'No' },
                    { name: 'Loss of Pay',  code: 'LOP', quota: 0, cf: 'No',  maxcf: 0, status: 'Active', used: 'Yes' }],
    bank:          [{ name: 'Meshrd Current — Chennai', bank: 'HDFC Bank', acc: 'XXXXXXXX4471', ifsc: 'HDFC0000521', branch: 'T. Nagar', status: 'Active' },
                    { name: 'Meshrd Payroll Account',   bank: 'ICICI Bank', acc: 'XXXXXXXX9012', ifsc: 'ICIC0001284', branch: 'Guindy',  status: 'Active' },
                    { name: 'Meshrd Current — Coimbatore', bank: 'Axis Bank', acc: 'XXXXXXXX3356', ifsc: 'UTIB0000412', branch: 'RS Puram', status: 'Inactive' }],
    paymentMode:   [{ name: 'Bank Transfer', code: 'BT', status: 'Active', used: 'Yes' }, { name: 'NEFT', code: 'NEFT', status: 'Active', used: 'Yes' },
                    { name: 'RTGS', code: 'RTGS', status: 'Active', used: 'Yes' }, { name: 'IMPS', code: 'IMPS', status: 'Active', used: 'No' },
                    { name: 'UPI', code: 'UPI', status: 'Active', used: 'Yes' }, { name: 'Cheque', code: 'CHQ', status: 'Active', used: 'Yes' },
                    { name: 'Cash', code: 'CSH', status: 'Active', used: 'Yes' }],
    department:    DEPTS.map((d, i) => ({ name: d, code: d.slice(0, 3).toUpperCase(), head: ['Vikram Iyer', 'Meera Joshi', 'Nisha Kulkarni', 'Fatima Sheikh', 'Karthik Nair', 'Ravi Shankar', 'Ayesha Khan'][i], status: 'Active', used: 'Yes' })),
    designation:   ['Founder & CEO', 'Engineering Manager', 'Senior Engineer', 'Engineer', 'Product Designer', 'Junior Designer', 'Senior Accountant', 'HR Manager', 'Support Engineer', 'Account Executive', 'Sales Executive', 'Operations Lead', 'Intern'].map(n => ({ name: n, code: n.split(' ').map(w => w[0]).join('').toUpperCase(), status: 'Active', used: 'Yes' })),
    /* tax: the linked head's real, editable name from taxHeads below — never a fake generic
       bucket. Different codes deliberately link to different heads (some IGST, some
       CGST+SGST, different rates) because that is exactly how HSN/SAC linkage works in
       practice, and the rate on any of them changes by editing that tax head in Taxes
       (§3.2) — versioned via its own Applies From/Until — never by touching this row. */
    hsn:           [{ code: '998314', desc: 'IT design and development services', tax: 'GST 18% — CGST + SGST', status: 'Active', used: 'Yes' },
                    { code: '998313', desc: 'IT consulting and support services',  tax: 'GST 18% — IGST', status: 'Active', used: 'Yes' },
                    { code: '998315', desc: 'IT support and maintenance — AMC',    tax: 'GST 12% — CGST + SGST', status: 'Active', used: 'Yes' },
                    { code: '998316', desc: 'IT infrastructure management',        tax: '—', status: 'Active', used: 'No' },
                    { code: '8471',   desc: 'Automatic data processing machines',  tax: 'Input GST 18% — IGST', status: 'Active', used: 'Yes' },
                    { code: '8523',   desc: 'Software licences, media & recorded storage', tax: 'Input GST 18% — CGST+SGST', status: 'Active', used: 'No' },
                    { code: '9954',   desc: 'Hardware bundled with installation — one-off retail order', tax: 'Custom — GST 28% IGST', status: 'Active', used: 'No' }],
    serviceCategory: [{ name: 'Platform Licence', code: 'PLAT', status: 'Active', used: 'Yes' }, { name: 'Implementation', code: 'IMPL', status: 'Active', used: 'Yes' },
                    { name: 'Custom Development', code: 'CDEV', status: 'Active', used: 'Yes' }, { name: 'Support & AMC', code: 'AMC', status: 'Active', used: 'Yes' },
                    { name: 'Training', code: 'TRN', status: 'Active', used: 'No' }],
    uom:           [{ name: 'Hours', code: 'HR', status: 'Active', used: 'Yes' }, { name: 'Days', code: 'DY', status: 'Active', used: 'Yes' },
                    { name: 'Licence', code: 'LIC', status: 'Active', used: 'Yes' }, { name: 'Nos', code: 'NOS', status: 'Active', used: 'Yes' },
                    { name: 'Months', code: 'MTH', status: 'Active', used: 'No' }],
    ticketCategories: [{ name: 'Access', code: 'ACC', status: 'Active', used: 'Yes' }, { name: 'Bug', code: 'BUG', status: 'Active', used: 'Yes' },
                    { name: 'Integration', code: 'INT', status: 'Active', used: 'Yes' }, { name: 'Billing', code: 'BIL', status: 'Active', used: 'Yes' },
                    { name: 'Enhancement', code: 'ENH', status: 'Active', used: 'Yes' }, { name: 'Performance', code: 'PRF', status: 'Active', used: 'Yes' },
                    { name: 'Onboarding', code: 'ONB', status: 'Active', used: 'Yes' }, { name: 'Account', code: 'ACT', status: 'Active', used: 'Yes' }],
    customerStatus: [{ name: 'Prospect', code: 'PRO', status: 'Active', used: 'Yes' }, { name: 'Active', code: 'ACT', status: 'Active', used: 'Yes' }, { name: 'Inactive', code: 'INA', status: 'Active', used: 'Yes' }],
    /* Email Configuration §3.21 — one place Super Admin points every outbound email
       at, instead of a mail server being wired into code nobody in Masters can see
       or change. `emailTemplates` is the dynamic list of trigger points that
       actually exist in this CMS today — Toggling one off silences that specific
       notification's email without touching the others or the server settings. */
    emailConfig: { provider: 'Custom SMTP', host: 'smtp.meshrd.in', port: 587, encryption: 'STARTTLS',
                   username: 'no-reply@meshrd.in', fromName: 'Meshrd', fromEmail: 'no-reply@meshrd.in',
                   replyTo: 'support@meshrd.in', status: 'Active', lastTest: '30-07-2026 · Delivered' },
    emailTemplates: [
      { name: 'Welcome Email',                category: 'Onboarding',  enabled: 'Yes', subject: 'Welcome to Meshrd, {{first_name}}!' },
      { name: 'Temporary Password',            category: 'Onboarding',  enabled: 'Yes', subject: 'Your Meshrd login — set your password' },
      { name: 'Offer / Appointment Letter',     category: 'Onboarding',  enabled: 'Yes', subject: 'Your appointment letter from Meshrd' },
      { name: 'Payslip Available',             category: 'Payroll',    enabled: 'Yes', subject: 'Your payslip for {{month}} is ready' },
      { name: 'Payslip Reissued',              category: 'Payroll',    enabled: 'Yes', subject: 'Your payslip for {{month}} was updated' },
      { name: 'Leave Approved',                category: 'Leave',      enabled: 'Yes', subject: 'Your leave request was approved' },
      { name: 'Leave Rejected',                category: 'Leave',      enabled: 'Yes', subject: 'Your leave request was declined' },
      { name: 'Document Verified',             category: 'Employee',   enabled: 'Yes', subject: '{{document_name}} has been verified' },
      { name: 'Document Rejected',             category: 'Employee',   enabled: 'Yes', subject: 'Action needed — {{document_name}} was rejected' },
      { name: 'Profile Change Approved',       category: 'Employee',   enabled: 'Yes', subject: 'Your profile update was approved' },
      { name: 'Profile Change Rejected',       category: 'Employee',   enabled: 'Yes', subject: 'Your profile update needs another look' },
      { name: 'Ticket Assigned',               category: 'Ticket',     enabled: 'Yes', subject: 'Ticket {{ticket_no}} has been assigned to you' },
      { name: 'Asset Request Approved',        category: 'Asset',      enabled: 'Yes', subject: 'Your asset request was approved' },
      { name: 'Asset Request Rejected',        category: 'Asset',      enabled: 'No',  subject: 'Your asset request was declined' },
      { name: 'Resignation Acceptance Letter', category: 'Offboarding',enabled: 'Yes', subject: 'Your resignation has been acknowledged' },
      { name: 'Password Reset',                category: 'Account',    enabled: 'Yes', subject: 'Reset your Meshrd password' }
    ],
    /* Re-added 2026-07-31 — removed 2026-07-30, restored on correction: the removal
       instruction only meant taking it off the Customer record's default view, not
       deleting the sub-master and the field together. Where a lead actually came
       from — Referral, Website, Cold Outreach — is the one thing Sales is asked
       about before anything else, and it drives which acquisition channel gets
       credit for a won deal. */
    customerSource: [{ name: 'Referral', code: 'REF', status: 'Active', used: 'Yes' }, { name: 'Website', code: 'WEB', status: 'Active', used: 'Yes' },
                     { name: 'Cold Outreach', code: 'CLD', status: 'Active', used: 'Yes' }, { name: 'Partner', code: 'PTR', status: 'Active', used: 'Yes' },
                     { name: 'Event / Conference', code: 'EVT', status: 'Active', used: 'No' }, { name: 'Inbound Enquiry', code: 'INB', status: 'Active', used: 'Yes' }],
    assetCategories: [{ name: 'Laptop', code: 'LAP', life: 3, status: 'Active', used: 'Yes' }, { name: 'Desktop', code: 'DSK', life: 4, status: 'Active', used: 'Yes' },
                    { name: 'Monitor', code: 'MON', life: 5, status: 'Active', used: 'Yes' }, { name: 'Mobile', code: 'MOB', life: 3, status: 'Active', used: 'Yes' },
                    { name: 'Furniture', code: 'FUR', life: 7, status: 'Active', used: 'Yes' }, { name: 'Printer', code: 'PRN', life: 5, status: 'Active', used: 'Yes' },
                    { name: 'Networking', code: 'NET', life: 6, status: 'Active', used: 'Yes' }, { name: 'Peripheral', code: 'PER', life: 3, status: 'Active', used: 'Yes' },
                    { name: 'Access', code: 'ACS', life: 5, status: 'Active', used: 'Yes' }],
    employmentType: [{ name: 'Full Time', code: 'FT', status: 'Active', used: 'Yes' }, { name: 'Part Time', code: 'PT', status: 'Active', used: 'No' },
                    { name: 'Contract', code: 'CTR', status: 'Active', used: 'Yes' }, { name: 'Intern', code: 'INT', status: 'Active', used: 'Yes' }],
    insurance:     [{ name: 'Group Health — Standard', type: 'Health',           cover: 500000,  emp: 0,    company: 12500, status: 'Active' },
                    { name: 'Group Health — Enhanced', type: 'Health',           cover: 1000000, emp: 4500, company: 18000, status: 'Active' },
                    { name: 'Group Term Life',         type: 'Life',             cover: 5000000, emp: 0,    company: 6800,  status: 'Active' },
                    { name: 'Personal Accident Cover', type: 'Personal Accident',cover: 2500000, emp: 0,    company: 3200,  status: 'Active' }],
    numberPrefixes: [{ doc: 'Employee ID',     prefix: 'EMP', fmt: 'EMP-<FY>-0000',  digits: 4, next: 15 },
                    { doc: 'Customer Code',    prefix: 'CUST',fmt: 'CUST-<FY>-0000', digits: 4, next: 9 },
                    { doc: 'Invoice Number',   prefix: 'INV', fmt: 'INV-<FY>-00000', digits: 5, next: 154 },
                    { doc: 'Credit Note',      prefix: 'CN',  fmt: 'CN-<FY>-0000',   digits: 4, next: 5 },
                    { doc: 'Purchase Bill ID', prefix: 'PB',  fmt: 'PB-<FY>-0000',   digits: 4, next: 32 },
                    { doc: 'Ticket Number',    prefix: 'TKT', fmt: 'TKT-<FY>-0000',  digits: 4, next: 913 },
                    { doc: 'Asset Tag',        prefix: 'AST', fmt: 'AST-<FY>-0000',  digits: 4, next: 14 },
                    { doc: 'Project Code',     prefix: 'PRJ', fmt: 'PRJ-<FY>-0000',  digits: 4, next: 9 },
                    { doc: 'Opportunity Code', prefix: 'OPP', fmt: 'OPP-<FY>-0000',  digits: 4, next: 9 },
                    { doc: 'Quote Number',     prefix: 'QUO', fmt: 'QUO-<FY>-0000',  digits: 4, next: 6 }],
    addresses:     [{ label: 'Registered Office', line: 'No. 14, Habibullah Road, T. Nagar', city: 'Chennai', state: 'Tamil Nadu', pin: '600017', primary: 'Yes' },
                    { label: 'Development Centre', line: '2nd Floor, Tidel Park, Taramani',  city: 'Chennai', state: 'Tamil Nadu', pin: '600113', primary: 'No' },
                    { label: 'Coimbatore Office',  line: '78, Avinashi Road, Peelamedu',      city: 'Coimbatore', state: 'Tamil Nadu', pin: '641004', primary: 'No' }]
  };

  /* Resolves a "Month Year" pay period label (e.g. "August 2026") to the actual date
     range it covers, reading Start Day / End Day live from D.masters.payrollCycle —
     never a hard-coded 26th/25th. Calendar-Month mode falls back to the plain month. */
  D.payPeriodRange = function (monthName, year) {
    const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const mi = MON.indexOf(monthName);
    const c = D.masters.payrollCycle;
    const pad = n => String(n).padStart(2, '0');
    const fmt = dt => pad(dt.getDate()) + '-' + pad(dt.getMonth() + 1) + '-' + dt.getFullYear();
    if (c.mode.indexOf('Calendar') === 0) {
      return { from: fmt(new Date(year, mi, 1)), to: fmt(new Date(year, mi + 1, 0)) };
    }
    return { from: fmt(new Date(year, mi - 1, c.startDay)), to: fmt(new Date(year, mi, c.endDay)) };
  };

  /* When salary actually reaches employees' accounts for a given pay period label —
     read live from Pay Cycle's Salary Credit Day, clamped to the real last day of that
     month (so a Credit Day of 30 or 31 still resolves in February, rather than
     silently rolling into March the way raw Date math would). */
  D.payCreditDate = function (monthName, year) {
    const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const mi = MON.indexOf(monthName);
    const c = D.masters.payrollCycle;
    const pad = n => String(n).padStart(2, '0');
    const lastDay = new Date(year, mi + 1, 0).getDate();
    const day = Math.min(c.creditDay || lastDay, lastDay);
    const dt = new Date(year, mi, day);
    return pad(dt.getDate()) + '-' + pad(dt.getMonth() + 1) + '-' + dt.getFullYear();
  };

  /* An event dated after the cycle's End Day always rolls into next month's run —
     never into the period that already closed. Concrete example, matching the
     26th–25th cycle above: leave taken on the 27th misses the 25th cutoff. */
  D.payrollCarryover = [
    { emp: 'Arun Menon', event: 'Paid Leave — Casual Leave (1 day)', date: '27-07-2026',
      closedPeriod: 'July 2026 (26-06-2026 to 25-07-2026)', deferredTo: 'August 2026 (26-07-2026 to 25-08-2026)',
      reason: '27-07-2026 falls after the 25th cutoff for July, so it is picked up by the next payroll run instead of the one that already closed.' }
  ];

  /* ---- Work-week calendar (derived from the Saturday rule on the default policy) ----
     Odd Saturdays (1st, 3rd, 5th) are working; even Saturdays (2nd, 4th) are week off.
     A Mandatory holiday always overrides the rule — see 15-08-2026, a 3rd Saturday. */
  D.masters.satCalendar = (function () {
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const ORD = ['1st', '2nd', '3rd', '4th', '5th'];
    const holBy = {}; D.holidays.forEach(h => { holBy[h.date] = h; });
    const out = [], seen = {};
    const d = new Date(2026, 3, 1), end = new Date(2027, 2, 31);
    for (; d <= end; d.setDate(d.getDate() + 1)) {
      if (d.getDay() !== 6) continue;
      const key = d.getFullYear() + '-' + d.getMonth();
      seen[key] = (seen[key] || 0) + 1;
      const n = seen[key], odd = n % 2 === 1;
      const date = String(d.getDate()).padStart(2, '0') + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + d.getFullYear();
      const h = holBy[date], blocked = h && h.type === 'Mandatory';
      out.push({
        month: MON[d.getMonth()] + ' ' + d.getFullYear(), date, ord: ORD[n - 1],
        rule: odd ? 'Working' : 'Week Off',
        actual: blocked ? 'Holiday' : (odd ? 'Working' : 'Week Off'),
        hrs: (blocked || !odd) ? 0 : 8,
        note: !h ? '—'
          : blocked ? h.name + ' — Mandatory holiday overrides the Saturday rule'
            : h.name + ' — Optional holiday, so the Saturday stays working; anyone taking it draws on their leave balance'
      });
    }
    return out;
  })();

  /* ---- Attendance — day-wise hour log (Arun Menon, June 2026) ---- */
  D.attendanceDaily = (function () {
    const DAYN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const satBy = {}; D.masters.satCalendar.forEach(s => { satBy[s.date] = s; });
    const holBy = {}; D.holidays.forEach(h => { holBy[h.date] = h; });
    const io = {
      1: ['09:12', '18:20'], 2: ['09:05', '18:10'], 3: ['09:20', '18:35'], 4: ['09:02', '18:05'], 5: ['09:15', '18:25'],
      6: ['09:30', '18:30'], 8: ['09:08', '18:12'], 9: ['09:10', '14:05'], 10: ['09:00', '18:00'],
      11: ['09:18', '18:40'], 12: ['09:06', '18:08'], 15: ['09:00', '18:02'], 16: ['09:14', '18:30'],
      17: ['09:03', '18:06'], 18: ['09:25', '18:20'], 19: ['09:09', '18:15'], 20: ['09:35', '18:45'],
      22: ['09:04', '18:04'], 23: ['09:11', '18:18'], 24: ['09:00', '17:50'], 25: ['09:07', '18:10'],
      26: ['09:02', '18:00'], 27: ['10:00', '14:30'], 29: ['09:16', '18:22'], 30: ['09:05', '18:06']
    };
    const compOn = { 27: 4.0 };  /* made the 09-Jun half day up on an off-Saturday of his own choosing */
    const mins = t => (+t.slice(0, 2)) * 60 + (+t.slice(3));
    const out = [];
    for (let n = 1; n <= 30; n++) {
      const dow = new Date(2026, 5, n).getDay();
      const date = String(n).padStart(2, '0') + '-06-2026';
      const sat = satBy[date], hol = holBy[date];
      let kind, req = 8;
      if (hol && hol.type === 'Mandatory') { kind = 'Holiday'; req = 0; }
      else if (dow === 0) { kind = 'Week Off — Sunday'; req = 0; }
      else if (dow === 6) {
        const working = sat && sat.actual === 'Working';
        kind = (sat ? sat.ord : '') + ' Saturday — ' + (working ? 'Working' : 'Week Off');
        req = working ? 8 : 0;
      } else kind = 'Working Day';
      const p = io[n];
      let brk = 0, worked = 0;
      if (p) {
        const gross = (mins(p[1]) - mins(p[0])) / 60;
        brk = gross < 6 ? 0.5 : 1;
        worked = +(gross - brk).toFixed(2);
      }
      const comp = compOn[n] || 0;
      let status;
      if (req === 0) status = p ? 'Comp / Extra Work' : (hol ? 'Holiday' : 'Week Off');
      else if (!p) status = 'Absent';
      else if (worked >= req) status = 'Full Day';
      else if (worked >= req - 0.25) status = 'Full Day — grace';
      else if (worked >= 4) status = 'Half Day';
      else status = 'Absent';
      out.push({
        /* bal is the day's own account: worked − required. comp is not added on top —
           it labels how much of `worked` is credited against an earlier shortfall. */
        date, day: DAYN[dow], kind, inT: p ? p[0] : '—', outT: p ? p[1] : '—',
        brk, req, worked, comp, bal: +(worked - req).toFixed(2), status,
        note: hol ? hol.name : (comp ? 'Compensating the 09-06-2026 shortfall — employee’s chosen day' : '—')
      });
    }
    return out;
  })();

  /* ---- Attendance — monthly hour summary (June 2026) ---- */
  D.attendanceMonthly = (function () {
    const BASE_DAYS = 24;   /* 22 weekdays + 2 working Saturdays (1st & 3rd) in June 2026 */
    /* `worked` is every net hour actually worked, comp days included. `comp` is an
       "of which" subset of it, not an addition — so credited = worked + leave only.
       Adding comp on top would credit the same hours twice. */
    const arun = D.attendanceDaily.reduce((a, r) => ({ w: a.w + r.worked, c: a.c + r.comp }), { w: 0, c: 0 });
    const seed = [
      { name: 'Ravi Shankar',    dept: 'Operations',      pol: 'Standard — 40 Hour Week',    worked: 197.5,            lv: 0, comp: 0 },
      { name: 'Vikram Iyer',     dept: 'Engineering',     pol: 'Standard — 40 Hour Week',    worked: 178.0,            lv: 2, comp: 0 },
      { name: 'Nisha Kulkarni',  dept: 'Accounts',        pol: 'Standard — 40 Hour Week',    worked: 192.0,            lv: 0, comp: 0 },
      { name: 'Fatima Sheikh',   dept: 'Human Resources', pol: 'Standard — 40 Hour Week',    worked: 176.0,            lv: 2, comp: 3.5 },
      { name: 'Arun Menon',      dept: 'Engineering',     pol: 'Standard — 40 Hour Week',    worked: +arun.w.toFixed(2), lv: 0, comp: arun.c },
      { name: 'Sneha Pillai',    dept: 'Engineering',     pol: 'Standard — 40 Hour Week',    worked: 190.5,            lv: 0, comp: 0 },
      { name: 'Rohit Deshmukh',  dept: 'Engineering',     pol: 'Standard — 40 Hour Week',    worked: 165.0,            lv: 1, comp: 0 },
      { name: 'Ayesha Khan',     dept: 'Design',          pol: 'Standard — 40 Hour Week',    worked: 176.5,            lv: 2, comp: 2.5 },
      { name: 'Karthik Nair',    dept: 'Support',         pol: 'Support — Rotational Shift', worked: 208.0,            lv: 0, comp: 0 },
      { name: 'Meera Joshi',     dept: 'Sales',           pol: 'Standard — 40 Hour Week',    worked: 193.0,            lv: 0, comp: 0 },
      { name: 'Divya Raman',     dept: 'Sales',           pol: 'Standard — 40 Hour Week',    worked: 158.5,            lv: 3, comp: 0 },
      { name: 'Imran Qureshi',   dept: 'Engineering',     pol: 'Intern — Half Day',          worked: 102.0,            lv: 0, comp: 0 }
    ];
    return seed.map(r => {
      const intern = r.pol.indexOf('Intern') === 0, six = r.pol.indexOf('Support') === 0;
      const dayNet = intern ? 4.5 : 8;
      const days = six ? 26 : (intern ? 22 : BASE_DAYS);
      const reqH = +(days * dayNet).toFixed(1);
      const lvH = +(r.lv * dayNet).toFixed(1);
      const credited = +(r.worked + lvH).toFixed(2);   /* comp is already inside worked */
      const bal = +(credited - reqH).toFixed(2);
      const short = bal < 0 ? +Math.abs(bal).toFixed(2) : 0;
      const payable = +Math.min(days, credited / dayNet).toFixed(2);
      return {
        name: r.name, dept: r.dept, pol: r.pol, dayNet, days, reqH,
        worked: r.worked, lvH, comp: r.comp, credited, bal, short,
        payable, lop: +Math.max(0, days - payable).toFixed(2),
        status: short === 0 ? 'Met' : (short <= dayNet ? 'Short — compensable' : 'Short — payroll impact')
      };
    });
  })();

  /* ---- Compensatory work requests (employee picks their own make-up day) ---- */
  D.compRequests = [
    { id: 'CMP-2627-0031', emp: 'Arun Menon',     dept: 'Engineering', shortDate: '09-06-2026', shortHrs: 3.58, makeupDate: '27-06-2026', makeupHrs: 4.0, reason: 'Family medical emergency — left after half day', status: 'Approved', by: 'Vikram Iyer', on: '10-06-2026' },
    { id: 'CMP-2627-0029', emp: 'Ayesha Khan',    dept: 'Design',      shortDate: '02-06-2026', shortHrs: 2.25, makeupDate: '06-06-2026', makeupHrs: 2.5, reason: 'Doctor appointment', status: 'Approved', by: 'Vikram Iyer', on: '03-06-2026' },
    { id: 'CMP-2627-0034', emp: 'Sneha Pillai',   dept: 'Engineering', shortDate: '18-06-2026', shortHrs: 1.50, makeupDate: '04-07-2026', makeupHrs: 2.0, reason: 'Left early — school event', status: 'Pending', by: '—', on: '—' },
    { id: 'CMP-2627-0036', emp: 'Rohit Deshmukh', dept: 'Engineering', shortDate: '22-06-2026', shortHrs: 8.00, makeupDate: '11-07-2026', makeupHrs: 8.0, reason: 'Personal — full day off taken without leave balance', status: 'Pending', by: '—', on: '—' },
    { id: 'CMP-2627-0038', emp: 'Divya Raman',    dept: 'Sales',       shortDate: '25-06-2026', shortHrs: 9.50, makeupDate: '—',          makeupHrs: 0,   reason: 'No make-up day proposed', status: 'Rejected', by: 'Meera Joshi', on: '26-06-2026' }
  ];

  /* ---- RBAC ---- */
  D.rbacRoles = [
    { role: 'Super Admin', people: 1, overrides: 0, desc: 'Unrestricted access to every screen in the CMS' },
    { role: 'Manager',     people: 2, overrides: 5, desc: 'Own records plus direct reports' },
    { role: 'Accountant',  people: 1, overrides: 3, desc: 'Finance modules, company-wide' },
    { role: 'HR',          people: 1, overrides: 2, desc: 'People modules, no financial figures' },
    { role: 'Employee',    people: 9, overrides: 2, desc: 'Own records only' }
  ];
  D.overrides = [
    { emp: 'Vikram Iyer',    role: 'Manager',    perm: 'Show Salary Amount to Manager', screen: 'Team Payslips',            module: 'Employee', type: 'Granted', by: 'Ravi Shankar', on: '18-07-2026' },
    { emp: 'Vikram Iyer',    role: 'Manager',    perm: 'Allow Manager to Run Payroll', screen: 'Run Payroll',             module: 'Payroll',  type: 'Granted', by: 'Ravi Shankar', on: '18-07-2026' },
    { emp: 'Nisha Kulkarni', role: 'Accountant', perm: 'Allow Accountant to Manage Taxes', screen: 'Masters → Taxes',         module: 'Masters',  type: 'Granted', by: 'Ravi Shankar', on: '02-07-2026' },
    { emp: 'Nisha Kulkarni', role: 'Accountant', perm: 'Give Accountant Read Access to Project Budgets', screen: 'Project Directory', module: 'Project', type: 'Granted', by: 'Ravi Shankar', on: '02-07-2026' },
    { emp: 'Arun Menon',     role: 'Employee',   perm: 'Allow Staff to Create New Tickets', screen: 'Ticket List',        module: 'Ticket',   type: 'Granted', by: 'Ravi Shankar', on: '24-06-2026' },
    { emp: 'Arun Menon',     role: 'Employee',   perm: 'Show Support Reports to Staff', screen: 'Support Reports',            module: 'Ticket',   type: 'Granted', by: 'Ravi Shankar', on: '24-06-2026' },
    { emp: 'Karthik Nair',   role: 'Employee',   perm: 'Allow Staff to Reassign Their Own Ticket', screen: 'Ticket Detail', module: 'Ticket',   type: 'Granted', by: 'Ravi Shankar', on: '11-06-2026' },
    { emp: 'Meera Joshi',    role: 'Manager',    perm: 'Restrict Manager to Only Their Own Customers', screen: 'Customer Directory', module: 'Customer', type: 'Revoked', by: 'Ravi Shankar', on: '05-06-2026' },
    { emp: 'Fatima Sheikh',  role: 'HR',         perm: 'Allow HR to Add Ad-hoc Payslip Adjustments', screen: 'Ad-hoc Payslip Adjustments', module: 'Payroll', type: 'Granted', by: 'Ravi Shankar', on: '20-05-2026' },
    { emp: 'Fatima Sheikh',  role: 'HR',         perm: 'Allow HR to Edit Core Info', screen: 'Asset Master Record',               module: 'Asset Management', type: 'Granted', by: 'Ravi Shankar', on: '20-05-2026' }
  ];
  D.permLog = [
    { when: '28-07-2026 15:22', who: 'Ravi Shankar', what: 'Screen visibility',  target: 'Employee → Project Report', from: 'Hidden', to: 'Visible', scope: 'Role: Employee' },
    { when: '24-07-2026 11:08', who: 'Ravi Shankar', what: 'Field toggle',       target: 'Show Salary Amount to Manager', from: 'OFF', to: 'ON', scope: 'Person: Vikram Iyer' },
    { when: '18-07-2026 09:41', who: 'Ravi Shankar', what: 'Action permission',  target: 'Ticket List → New Ticket', from: 'Denied', to: 'Allowed', scope: 'Person: Arun Menon' },
    { when: '12-07-2026 16:55', who: 'Ravi Shankar', what: 'Scope restriction',  target: 'Customer Directory', from: 'All', to: 'Own', scope: 'Role: Manager' },
    { when: '02-07-2026 10:30', who: 'Ravi Shankar', what: 'Field toggle',       target: 'Allow Accountant to Manage Taxes', from: 'OFF', to: 'ON', scope: 'Person: Nisha Kulkarni' },
    { when: '28-06-2026 14:12', who: 'Ravi Shankar', what: 'Screen visibility',  target: 'Accountant → Leave Reports', from: 'Hidden', to: 'Visible', scope: 'Role: Accountant' }
  ];
  /* 46 toggles compiled in RBAC §2.1 — a representative slice per module drives the matrix UI */
  D.toggles = {
    Employee: ['Show Salary Amount to Manager', 'Allow Employee to Edit Bank Details Directly', 'Show Financial Year Management to Manager', 'Allow Manager to Edit Team Member Employment Details', 'Require Manager Acknowledgment Before HR Processes Exit', 'Allow HR to Edit Salary Structure', 'Allow HR to Edit Statutory Applicability Toggles', 'Allow Employee to Change Insurance Plan Mid-Year'],
    Masters: ['Allow Accountant to Manage Taxes'],
    'Asset Management': ['Allow Manager to Reassign Assets Directly', 'Show Purchase Value to Manager', 'Allow HR to Edit Depreciation Method', 'Allow HR to Edit Core Info'],
    Ticket: ['Allow Staff to View the Full Open Ticket Queue', 'Allow Staff to Reassign Their Own Ticket', 'Show Support Reports to Staff', 'Allow Staff to Create New Tickets', 'Require Satisfaction Rating on Close'],
    'Leave & Payroll': ['Allow Manager to Adjust Team Leave Balance', 'Require HR Co-Approval for Leave Longer Than X Days', 'Allow Manager to Run Payroll', 'Allow HR to Add Ad-hoc Payslip Adjustments', 'Hide Ad-hoc Adjustment Labels from Employee', 'Require Super Admin Approval to Reissue a Payslip', 'Notify Employee When a Payslip Is Reissued'],
    Vendor: ['Allow Manager to Edit Vendor Bank & GST Details', 'Allow Hard Delete of a Vendor', 'Require Approval to Add a New Vendor'],
    Customer: ['Restrict Manager to Only Their Own Customers', 'Give Accountant Read Access to Customer Financial Summary', 'Allow Employee to Log Activities on Customers They\'re Staffed On'],
    Opportunity: ['Restrict Manager to Only Their Own Opportunities', 'Give Accountant Read Access to Pipeline Value', 'Allow Employee to View the Opportunity Behind Their Assigned Project'],
    Project: ['Restrict Manager to Only Projects They Manage', 'Give Accountant Read Access to Project Budgets', 'Allow Employee to Manage Sprints on Their Own Projects', 'Show Project Report to Employee', 'Hide Budget from Employee\'s Project View'],
    Invoice: ['Allow Manager Read-Only Access to Their Projects\' Invoices', 'Require Second Approval Before an Invoice Locks as Paid', 'Show Non-Financial Dashboard Widgets to HR'],
    Expense: ['Allow Manager to Approve Their Team\'s Expenses', 'Require a Receipt Before Approval', 'Set an Auto-Approval Threshold', 'Auto-Mark as Reimbursed When Paid via Payroll'],
    'Purchase Bill': ['Require Attachment Before Marking a Bill Paid', 'Lock Purchase Bill Once Fully Paid', 'Give Manager Read-Only Access to Purchase Bills'],
    /* RBAC §8 — the one toggle the RBAC module defines about itself. */
    'Roles & Access': ['Give HR Read-Only Access to the Permission Matrix']
  };
  D.defaultOn = ['Require Manager Acknowledgment Before HR Processes Exit', 'Notify Employee When a Payslip Is Reissued'];

  /* ==========================================================================
     SCREEN REGISTRY — 14 modules
     roles: which roles see this screen (RBAC Layer 1)
     scope: per-role data scope (RBAC Layer 4)
     ========================================================================== */
  const FIN_PRESETS = ['This Financial Year', 'This Month', 'Last Month', 'This Quarter', 'Last Financial Year', 'All financial years', 'Custom'];
  /* Meshrd's own accounts, read live from Masters → Company Profile → Bank Accounts
     so a filter or dropdown can never list an account that no longer exists. */
  const BANKS = D.masters.bank.filter(b => b.status === 'Active').map(b => b.name);

  const MODULES = [
    /* ------------------------------------------------ OVERVIEW */
    {
      group: 'Overview', id: 'home', label: 'Dashboard', icon: 'dash', single: true,
      screens: [{ id: 'dashboard', label: 'Dashboard', ref: 'Employee §2.11 · Invoice §2.1', type: 'dashboard', roles: ALL }]
    },

    /* ------------------------------------------------ PEOPLE */
    {
      group: 'People', id: 'employee', label: 'Employee', icon: 'employee', ref: 'Module 2',
      screens: [
        {
          id: 'emp.directory', label: 'Employee Directory', ref: '§2.1', type: 'list',
          roles: ['superadmin', 'manager', 'accountant', 'hr'], scope: { manager: 'team' },
          desc: 'The searchable master list of every staff member. Manager\'s rows are filtered to direct reports only.',
          filters: [DEPTS, ['All Designations', 'Senior Engineer', 'Engineer', 'Product Designer', 'HR Manager'], ['All Statuses', 'Active', 'On Notice', 'Exited', 'Inactive'], ['All Employment Types', 'Full Time', 'Part Time', 'Contract', 'Intern'], ['All Locations', 'Chennai', 'Coimbatore']],
          filterNames: ['Department', 'Designation', 'Status', 'Employment Type', 'Work Location'],
          columns: [{ k: 'id', t: 'Employee ID', c: 'mono cell-accent' }, { k: 'name', t: 'Name', c: 'cell-strong', avatar: 1 }, { k: 'dept', t: 'Department' }, { k: 'desig', t: 'Designation' }, { k: 'type', t: 'Employment Type' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'mgr', t: 'Reporting Manager' }, { k: 'phone', t: 'Phone', c: 'mono' }, { k: 'join', t: 'Joining Date', c: 'mono' }],
          rows: 'employees', rowGo: 'emp.record', empty: 'No employees added yet.',
          actions: [{ label: '+ Add Employee', primary: 1, roles: ['superadmin', 'hr'], go: 'emp.record' }]
        },
        {
          id: 'emp.record', label: 'Employee Master Record', ref: '§2.2', type: 'record',
          roles: ['superadmin', 'manager', 'accountant', 'hr'], scope: { manager: 'team' },
          desc: 'The complete HR record for one staff member. HR and Super Admin edit; Manager and Accountant are read-only.',
          record: 'employee'
        },
        { id: 'emp.profile', label: 'My Profile', ref: '§2.3', type: 'record', roles: ALL, record: 'myprofile', desc: 'The same record, opened by the logged-in person about themselves — split by what they can and cannot edit directly.' },
        {
          id: 'emp.documents', label: 'My Documents', ref: '§2.7', type: 'list', roles: ALL, scope: { all: 'own' },
          desc: 'Personal paperwork uploaded by the employee, with HR\'s verification status against each file.',
          filters: [['All Document Types', 'ID Proof', 'Educational Certificate', 'Resume', 'Offer Letter Copy', 'Others'], ['All Statuses', 'Pending Verification', 'Verified', 'Rejected']],
          filterNames: ['Document Type', 'Status'],
          columns: [{ k: 'type', t: 'Document Type', c: 'cell-strong' }, { k: 'file', t: 'File Name', c: 'mono' }, { k: 'up', t: 'Uploaded On', c: 'mono' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'rej', t: 'Rejection Reason' }],
          rows: 'myDocs', empty: 'No documents uploaded yet.',
          actions: [{ label: '+ Upload Document', primary: 1 , go: 'emp.upload' }], rowActions: ['View', 'Delete']
        },
        {
          id: 'emp.docqueue', label: 'Document Verification Queue', ref: '§2.7', type: 'list', roles: ['superadmin', 'hr'],
          desc: 'A single queue across every employee\'s Pending Verification documents. Reject requires a reason.',
          filters: [['All Employees'].concat(PEOPLE), DEPTS, ['All Document Types', 'ID Proof', 'Educational Certificate', 'Resume', 'Offer Letter Copy'], ['Pending Verification', 'Verified', 'Rejected', 'All Statuses']],
          filterNames: ['Employee', 'Department', 'Document Type', 'Status'],
          columns: [{ k: 'emp', t: 'Employee', c: 'cell-strong' }, { k: 'dept', t: 'Department' }, { k: 'type', t: 'Document Type' }, { k: 'up', t: 'Uploaded On', c: 'mono' }, { k: 'wait', t: 'Waiting (days)', c: 'mono r', th: 'r' }],
          rows: 'docQueue', empty: 'Nothing waiting for verification.',
          rowActions: [{ l: 'Verify', c: 'ok' }, { l: 'Reject', c: 'no', go: 'emp.docreject' }]
        },
        {
          id: 'emp.assets', label: 'My Assets', ref: '§2.10', type: 'list', roles: ALL, scope: { all: 'own' },
          desc: 'Assets currently assigned to this person, and where Repair / Damage / Return requests are raised.',
          filters: [['All Categories', 'Laptop', 'Monitor', 'Peripheral', 'Mobile'], ['All Statuses', 'In Use', 'Under Repair']],
          filterNames: ['Category', 'Status'],
          columns: [{ k: 'tag', t: 'Asset Tag', c: 'mono cell-accent' }, { k: 'name', t: 'Asset Name', c: 'cell-strong' }, { k: 'cat', t: 'Category' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'pdate', t: 'Assigned Date', c: 'mono' }],
          rows: 'myAssets', empty: 'No assets assigned to you.',
          actions: [{ label: '+ Raise Request', primary: 1 , go: 'emp.assetreq' }], rowActions: ['Repair', 'Damage', 'Return']
        },
        {
          id: 'emp.announce', label: 'Announcements & Notifications', ref: '§2.12', type: 'feedpage', roles: ALL,
          desc: 'Company-wide announcements posted by HR/Super Admin, and personal notifications generated by events elsewhere.'
        },
        { id: 'emp.onboarding', label: 'Onboarding Checklist', ref: '§2.13', type: 'checklist', roles: ['superadmin', 'hr'], list: 'onboardingSteps', subject: 'Divya Raman', subjectSub: 'Sales Executive · Joined 27-07-2026 · EMP-2026-0011', desc: 'Seven steps, most auto-checked when the linked action completes elsewhere in the CMS.' },
        {
          id: 'emp.onboardqueue', label: 'Onboarding — All Employees', ref: '§2.13', type: 'list', roles: ['superadmin', 'hr'],
          desc: 'HR\'s cross-employee view of everyone currently mid-onboarding.',
          filters: [DEPTS, ['All Completion States', 'Not Started', 'In Progress', 'Complete']],
          filterNames: ['Department', 'Completion'],
          columns: [{ k: 'emp', t: 'Employee', c: 'cell-strong' }, { k: 'join', t: 'Joining Date', c: 'mono' }, { k: 'dept', t: 'Department' }, { k: 'done', t: 'Steps Completed', c: 'mono' }, { k: 'stuck', t: 'Oldest Incomplete Step' }, { k: 'days', t: 'Days Since Joining', c: 'mono r', th: 'r' }],
          rows: 'onboardingQueue', rowGo: 'emp.onboarding', empty: 'Nobody is mid-onboarding right now.'
        },
        { id: 'emp.offboarding', label: 'Offboarding / Exit', ref: '§2.14', type: 'checklist', roles: ['superadmin', 'hr'], list: 'exitSteps', subject: 'Suresh Babu', subjectSub: 'Operations Lead · Last working day 12-08-2026 · EMP-2026-0013', desc: 'Runs after the Reporting Manager acknowledges the resignation. The resignation acceptance letter is generated first — it fixes the Last Working Day — and only then does asset return open. Every assigned asset must show Returned or Retired before final settlement, login disablement or the Exited status can be actioned.' },
        {
          id: 'emp.exitqueue', label: 'Exits — All Employees', ref: '§2.14', type: 'list', roles: ['superadmin', 'hr'],
          desc: 'Every in-progress exit at once. "Assets still outstanding" is the filter that matters most here.',
          filters: [DEPTS, ['All Acknowledgment States', 'Acknowledged', 'Awaiting Manager'], ['All Completion States', 'In Progress', 'Complete']],
          filterNames: ['Department', 'Manager Acknowledged', 'Completion'],
          columns: [{ k: 'emp', t: 'Employee', c: 'cell-strong' }, { k: 'lwd', t: 'Last Working Day', c: 'mono' }, { k: 'dept', t: 'Department' }, { k: 'ack', t: 'Manager Acknowledged', type: 'status' }, { k: 'done', t: 'Steps Completed', c: 'mono' }, { k: 'assets', t: 'Assets Outstanding', c: 'mono r', th: 'r' }, { k: 'settle', t: 'Final Settlement', type: 'status' }],
          rows: 'exitQueue', rowGo: 'emp.offboarding', empty: 'No exits in progress.'
        },
        { id: 'emp.letter', label: 'Offer & Appointment Letter', ref: '§2.15', type: 'letter', roles: ['superadmin', 'hr'], desc: 'HR generates the official letter. Custom Terms queue automatically as Ad-hoc Payslip Adjustments from the Joining Date.' },
        { id: 'emp.attendance', navHidden: 1, label: 'Record Attendance', ref: '§2.2', type: 'form', form: 'e.attendance', roles: ['superadmin'], desc: 'Manual entry today; the Biometric option is visible but disabled. Both write to the same underlying record.' },
        { id: 'emp.changereq', navHidden: 1, label: 'Request Profile Change', ref: '§2.3', type: 'form', form: 'e.changereq', roles: ['superadmin','manager','accountant','hr','employee'], desc: 'Fields an employee cannot edit directly raise a change request for HR approval instead.' },
        { id: 'emp.upload', navHidden: 1, label: 'Upload Document', ref: '§2.7', type: 'form', form: 'e.upload', roles: ['superadmin','manager','accountant','hr','employee'], desc: 'Super Admin uploads are automatically marked Verified. All other roles start at Pending Verification and require HR approval.' },
        { id: 'emp.docreject', navHidden: 1, label: 'Reject Document', ref: '§2.7', type: 'form', form: 'e.docreject', roles: ['superadmin','hr'], desc: 'Reject requires a short reason, shown back to the employee so they can correct and re-upload.' },
        { id: 'emp.assetreq', navHidden: 1, label: 'Raise Asset Request', ref: '§2.10', type: 'form', form: 'e.assetreq', roles: ['superadmin','manager','accountant','hr','employee'], desc: 'Repair, Damage Report or Return — the three request types an employee can raise.' },
        { id: 'emp.postannounce', navHidden: 1, label: 'Post Announcement', ref: '§2.12', type: 'form', form: 'e.announce', roles: ['superadmin','hr'], desc: 'Posting is HR and Super Admin only.' }
      ]
    },
    {
      group: 'People', id: 'leavepay', label: 'Leave & Payroll', icon: 'payroll', ref: 'Modules 5 & 6',
      screens: [
        {
          id: 'leave.my', label: 'My Leave', ref: '§2.1', type: 'leavemy', roles: ALL, scope: { all: 'own' },
          desc: 'Balance, application, and history — identical for every role. Insufficient balance is a hard block, not a warning.'
        },
        {
          id: 'leave.approvals', label: 'Leave Approvals', ref: '§2.2', type: 'list',
          roles: ['superadmin', 'manager', 'hr'], scope: { manager: 'team' },
          desc: 'Routed to the applicant\'s Reporting Manager; to HR if none is set, or if the applicant is a Manager/Accountant/HR person. Rejection requires a reason.',
          filters: [['All Employees'].concat(PEOPLE), DEPTS, ['All Leave Types', 'Casual Leave', 'Sick Leave', 'Earned Leave', 'Comp Off'], ['All Routings', 'Vikram Iyer', 'HR', 'Super Admin']],
          filterNames: ['Employee', 'Department', 'Leave Type', 'Routed To'],
          columns: [{ k: 'emp', t: 'Employee', c: 'cell-strong', avatar: 1 }, { k: 'type', t: 'Leave Type' }, { k: 'dates', t: 'Dates' }, { k: 'days', t: 'Days', c: 'mono r', th: 'r' }, { k: 'reason', t: 'Reason' }, { k: 'applied', t: 'Date Applied', c: 'mono' }, { k: 'routed', t: 'Routed To', c: 'cell-strong' }, { k: 'aging', t: 'Aging (days)', c: 'mono r', th: 'r' }],
          rows: 'leaveApprovals', empty: 'No leave requests waiting on you.',
          rowActions: [{ l: 'Approve', c: 'ok' }, { l: 'Reject', c: 'no', go: 'leave.reject' }]
        },
        {
          id: 'leave.balance', label: 'Leave Balance Management', ref: '§2.3', type: 'list', roles: ['superadmin', 'hr'],
          desc: 'Balance corrections and the year-end carry-forward run. Every adjustment requires a reason and is logged.',
          filters: [['Casual Leave', 'Sick Leave', 'Earned Leave', 'Comp Off'], DEPTS, ['All Statuses', 'Active', 'On Notice', 'Exited']],
          filterNames: ['Leave Type', 'Department', 'Employee Status'],
          columns: [{ k: 'emp', t: 'Employee', c: 'cell-strong' }, { k: 'allowed', t: 'Allowed', c: 'mono r', th: 'r' }, { k: 'cf', t: 'Carried Forward', c: 'mono r', th: 'r' }, { k: 'taken', t: 'Taken', c: 'mono r', th: 'r' }, { k: 'pending', t: 'Pending', c: 'mono r', th: 'r' }, { k: 'remaining', t: 'Remaining', c: 'mono r cell-strong', th: 'r', calc: r => r.allowed + r.cf - r.taken - r.pending }],
          rows: 'leaveBalanceAdmin', empty: 'No balances to show.',
          actions: [{ label: 'Run Year-End Carry-Forward', primary: 1, go: 'leave.carryfwd' }, { label: 'Adjustment History', go: 'leave.adjhistory' }], rowActions: [{ l: 'Adjust Balance', go: 'leave.adjust' }]
        },
        {
          id: 'leave.comp', label: 'Compensatory Hours', ref: '§2.6', type: 'list', roles: ALL,
          scope: { employee: 'own', manager: 'team' },
          desc: 'When someone falls short of the day’s net hours, they make the balance up on a day of their own choosing — this is where that is requested and approved. Approved make-up hours are credited back against the shortfall, so payroll stops treating it as a shortfall. Rejected or unclaimed hours fall through to Loss of Pay.',
          filters: [['All Employees'].concat(PEOPLE), DEPTS, ['All Statuses', 'Pending', 'Approved', 'Rejected'], ['June 2026', 'May 2026', 'July 2026', 'All periods']],
          filterNames: ['Employee', 'Department', 'Status', 'Period'],
          columns: [{ k: 'id', t: 'Request #', c: 'mono cell-accent' }, { k: 'emp', t: 'Employee', c: 'cell-strong' }, { k: 'dept', t: 'Department' }, { k: 'shortDate', t: 'Shortfall Date', c: 'mono' }, { k: 'shortHrs', t: 'Hours Short', c: 'mono r', th: 'r' }, { k: 'makeupDate', t: 'Make-Up Date', c: 'mono' }, { k: 'makeupHrs', t: 'Hours Made Up', c: 'mono r', th: 'r' }, { k: 'reason', t: 'Reason' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'by', t: 'Approved By' }],
          rows: 'compRequests', empty: 'No compensatory hour requests.',
          actions: [{ label: '+ Request Compensatory Hours', primary: 1, go: 'leave.comp.add' }],
          rowActions: [{ l: 'Approve', c: 'ok', roles: ['superadmin', 'manager', 'hr'] }, { l: 'Reject', c: 'no', roles: ['superadmin', 'manager', 'hr'], go: 'leave.reject' }]
        },
        { id: 'leave.comp.add', navHidden: 1, label: 'Request Compensatory Hours', ref: '§2.6', type: 'form', form: 'l.comp', roles: ALL, desc: 'The make-up date is the employee’s own choice, subject to the compensation window on the work-week policy. It cannot fall on a Mandatory holiday, and it must stay inside the same payroll period unless the policy allows carrying it forward.' },
        { id: 'leave.holidays', label: 'Company Holiday Calendar', ref: '§2.4', type: 'calendar', roles: ALL, desc: 'Read-only for everyone — sourced entirely from Masters → Holidays. All five roles get the identical filter set. Working Saturdays come from Masters → Work Week & Hours, not from this calendar.' },
        { id: 'leave.reports', label: 'Leave Reports', ref: '§2.5', type: 'report', roles: ['superadmin', 'hr', 'accountant'], report: 'leave', desc: 'All filters apply across all four views simultaneously, so switching view never silently changes the underlying set.' },
        { id: 'payroll.run', label: 'Run Payroll', ref: '§2.1', type: 'payrollrun', roles: ['superadmin', 'accountant', 'hr'], desc: 'Pick a period, calculate, preview, then generate payslips. This module contains no knowledge of any specific deduction — it reads configured tax heads and applies them.' },
        {
          id: 'payroll.history', label: 'Payroll History', ref: '§2.1', type: 'list', roles: ['superadmin', 'accountant', 'hr'],
          desc: 'Past runs. A Draft run can be recalculated or discarded freely; a Processed run cannot be re-run for the same period.',
          filters: [['FY 2026–27', 'FY 2025–26', 'All financial years'], ['All Statuses', 'Draft', 'Processed'], ['All Run By', 'Nisha Kulkarni', 'Ravi Shankar', 'Fatima Sheikh']],
          filterNames: ['Financial Year', 'Run Status', 'Run By'],
          columns: [{ k: 'period', t: 'Pay Period', c: 'cell-strong' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'by', t: 'Run By' }, { k: 'on', t: 'Run On', c: 'mono' }, { k: 'count', t: 'Employees', c: 'mono r', th: 'r' }, { k: 'net', t: 'Total Net Pay', type: 'money', c: 'r', th: 'r' }],
          rows: 'payrollRuns', empty: 'No payroll runs yet.'
        },
        {
          id: 'payroll.adhoc', label: 'Ad-hoc Payslip Adjustments', ref: '§2.1a', type: 'list', roles: ['superadmin', 'accountant'],
          desc: 'One-time or short-term additions and recoveries. A permanent hike is a new Salary Structure entry, not an adjustment.',
          filters: [['All Employees'].concat(PEOPLE), ['All Types', 'Addition', 'Subtraction'], ['Taxable — Any', 'Yes', 'No'], ['Recurring — Any', 'Yes', 'No']],
          filterNames: ['Employee', 'Type', 'Taxable', 'Recurring'],
          columns: [{ k: 'emp', t: 'Applies To', c: 'cell-strong' }, { k: 'label', t: 'Label' }, { k: 'type', t: 'Type', type: 'chip' }, { k: 'amt', t: 'Amount', type: 'money', c: 'r', th: 'r' }, { k: 'taxable', t: 'Taxable', type: 'status' }, { k: 'rec', t: 'Recurring', type: 'status' }, { k: 'by', t: 'Created By' }, { k: 'on', t: 'Date Added', c: 'mono' }],
          rows: 'adhoc', empty: 'No pending adjustments for this payroll run.',
          actions: [{ label: '+ Add Adjustment', primary: 1 , go: 'payroll.adhoc.add' }], rowActions: ['Edit', 'Remove']
        },
        {
          id: 'payroll.mine', label: 'My Payslips', ref: '§2.2', type: 'list', roles: ALL, scope: { all: 'own' },
          desc: 'Only Processed months appear. "Download Salary Certificate" produces a separate formal letter, generated on demand.',
          filters: [['FY 2026–27', 'FY 2025–26', 'All financial years'], ['All Months', 'January', 'February', 'March', 'April', 'May', 'June'], ['All Statuses', 'Processed', 'Reissued']],
          filterNames: ['Financial Year', 'Month', 'Payslip Status'],
          columns: [{ k: 'period', t: 'Pay Period', c: 'cell-strong' }, { k: 'net', t: 'Net Pay', type: 'money', c: 'r', th: 'r' }, { k: 'processed', t: 'Date Processed', c: 'mono' }, { k: 'status', t: 'Status', type: 'status' }],
          rows: 'myPayslips', rowGo: 'payroll.slip', empty: 'No payslips yet.',
          actions: [{ label: 'Download Salary Certificate', go: 'payroll.salcert' }], rowActions: ['Download']
        },
        { id: 'payroll.slip', label: 'Payslip', ref: '§2.2', type: 'payslip', roles: ALL, desc: 'The full breakup. Ad-hoc lines print under their actual label, never a generic "Adjustment".' },
        {
          id: 'payroll.register', label: 'Payroll Register', ref: '§2.4', type: 'list', roles: ['superadmin', 'accountant', 'hr'],
          desc: 'Full payslip access company-wide, plus Reissue. A reissue always records a Reason and keeps the old figures alongside the new.',
          filters: [['All Employees'].concat(PEOPLE), ['June 2026', 'May 2026', 'April 2026'], DEPTS, ['All Statuses', 'Draft', 'Processed', 'Reissued']],
          filterNames: ['Employee', 'Month', 'Department', 'Payroll Run Status'],
          columns: [{ k: 'emp', t: 'Employee', c: 'cell-strong', avatar: 1 }, { k: 'code', t: 'Employee Code', c: 'mono' }, { k: 'month', t: 'Month' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'net', t: 'Net Pay', type: 'money', c: 'r', th: 'r' }],
          rows: 'payrollRegister', rowGo: 'payroll.slip', empty: 'No payslips generated yet.',
          rowActions: ['View', { l: 'Reissue', go: 'payroll.reissue' }]
        },
        { id: 'payroll.attendance', label: 'Attendance & Time Basis', ref: '§2.5', type: 'attendance', roles: ['superadmin', 'hr', 'manager'], scope: { manager: 'team' }, desc: 'Hours are the unit of account, not days. Required hours come from the work-week policy in Masters (net hours × working days, with the Saturday rule applied); worked hours come from check-in / check-out less the unpaid break. Approved leave and approved compensatory hours are credited. Whatever is still short is converted to Loss of Pay at the rate the policy specifies.' },
        { id: 'emp.tax', label: 'My Tax Declarations', ref: 'Employee §2.14', type: 'taxdecl', roles: ALL, desc: 'Generated entirely from Masters → Taxes. This screen does not know the name of any deduction. Grouped here with Leave & Payroll since it directly feeds Payroll’s income-tax calculation — still documented in the Employee module (§2.14), just relocated in the sidebar.' },
        { id: 'leave.apply', navHidden: 1, label: 'Apply for Leave', ref: '§2.1', type: 'form', form: 'l.apply', roles: ['superadmin','manager','accountant','hr','employee'], desc: 'Insufficient balance is a hard block: submission is refused outright, with the exact shortfall stated.' },
        { id: 'leave.reject', navHidden: 1, label: 'Reject Leave Request', ref: '§2.2', type: 'form', form: 'l.reject', roles: ['superadmin','manager','hr'], desc: 'Rejection requires a reason everywhere in this CMS.' },
        { id: 'leave.adjust', navHidden: 1, label: 'Adjust Balance', ref: '§2.3', type: 'form', form: 'l.adjust', roles: ['superadmin','hr'], desc: 'Every adjustment requires a reason and is logged to Adjustment History.' },
        { id: 'leave.carryfwd', navHidden: 1, label: 'Run Year-End Carry-Forward', ref: '§2.3', type: 'form', form: 'l.carryfwd', roles: ['superadmin','hr'], desc: 'A manual, deliberate action — shows a preview before committing.' },
        { id: 'leave.adjhistory', navHidden: 1, label: 'Adjustment History', ref: '§2.3', type: 'form', form: 'l.adjhistory', roles: ['superadmin','hr'], desc: 'Every balance adjustment is logged — Date, Leave Type, Amount, Reason, Adjusted By. An adjustment log that cannot be filtered by who made the adjustment is not much of an audit trail.' },
        { id: 'payroll.adhoc.add', navHidden: 1, label: 'Add Ad-hoc Adjustment', ref: '§2.1a', type: 'form', form: 'p.adhoc', roles: ['superadmin','accountant'], desc: 'One-time or short-term items only. A permanent hike is a new Salary Structure entry, not an adjustment.' },
        { id: 'payroll.salcert', navHidden: 1, label: 'Request Salary Certificate', ref: '§2.2', type: 'form', form: 'p.salcert', roles: ['superadmin','manager','accountant','hr','employee'], desc: 'A formal letter confirming employment and salary, generated on demand.' },
        { id: 'payroll.reissue', navHidden: 1, label: 'Reissue Payslip', ref: '§2.4', type: 'form', form: 'p.reissue', roles: ['superadmin','accountant','hr'], desc: 'A Reason is required either way before a reissue can be confirmed.' }
      ]
    },
    {
      group: 'People', id: 'asset', label: 'Asset Management', icon: 'asset', ref: 'Module 3',
      screens: [
        {
          id: 'asset.directory', label: 'Asset Directory', ref: '§2.1', type: 'list',
          roles: ['superadmin', 'accountant', 'hr', 'manager'], scope: { manager: 'team' },
          desc: 'Every company-owned asset. Purchase Value and Current Value are hidden from Manager by default — and the value range filter goes with them.',
          filters: [['All Categories', 'Laptop', 'Monitor', 'Mobile', 'Furniture', 'Printer', 'Networking', 'Peripheral'], ['All Statuses', 'In Use', 'In Store', 'Under Repair', 'Retired-Disposed'], ['All Employees'].concat(PEOPLE), ['All Locations', 'Chennai', 'Coimbatore']],
          filterNames: ['Category', 'Status', 'Assigned Employee', 'Location'],
          columns: [{ k: 'tag', t: 'Asset Tag', c: 'mono cell-accent' }, { k: 'name', t: 'Name', c: 'cell-strong' }, { k: 'cat', t: 'Category' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'to', t: 'Assigned To' }, { k: 'pv', t: 'Purchase Value', type: 'money', c: 'r', th: 'r', hideFrom: ['manager'] }, { k: 'cv', t: 'Current Value', type: 'money', c: 'r', th: 'r', hideFrom: ['manager'] }],
          rows: 'assets', rowGo: 'asset.record', empty: 'No assets added yet.',
          actions: [{ label: '+ Add Asset', primary: 1, roles: ['superadmin', 'accountant'] }, { label: 'Download Asset List' }]
        },
        { id: 'asset.record', label: 'Asset Master Record', ref: '§2.2', type: 'record', roles: ['superadmin', 'accountant', 'hr', 'manager'], scope: { manager: 'team' }, record: 'asset', desc: 'Status and Assigned To lock after creation — every change routes through Assign / Transfer / Unassign so the history stays complete.' },
        { id: 'asset.assign', label: 'Assign / Transfer / Unassign', ref: '§2.3', type: 'assign', roles: ['superadmin', 'hr'], desc: 'Three administrative actions, each logged permanently in the asset\'s Assignment History. Transfer is HR/Super Admin only.' },
        {
          id: 'asset.maintenance', label: 'Maintenance & Service Log', ref: '§2.4', type: 'list',
          roles: ['superadmin', 'accountant', 'hr', 'manager'], scope: { manager: 'team' },
          desc: 'Company-wide across every asset the viewer can see. Accountant and Super Admin add and edit; HR and Manager view.',
          filters: [['All Categories', 'Laptop', 'Monitor', 'Printer', 'Networking'], ['All Statuses', 'Completed', 'Overdue', 'Upcoming'], ['All Assets'].concat(D.assets.map(a => a.tag))],
          filterNames: ['Category', 'Maintenance Status', 'Asset'],
          columns: [{ k: 'tag', t: 'Asset Tag', c: 'mono cell-accent' }, { k: 'name', t: 'Asset Name', c: 'cell-strong' }, { k: 'date', t: 'Service Date', c: 'mono' }, { k: 'desc', t: 'Description' }, { k: 'cost', t: 'Cost', type: 'money', c: 'r', th: 'r' }, { k: 'next', t: 'Next Due', c: 'mono' }, { k: 'status', t: 'Status', type: 'status' }],
          rows: 'maintenance', empty: 'No maintenance logged yet.',
          actions: [{ label: '+ Add Maintenance Entry', primary: 1, roles: ['superadmin', 'accountant'] , go: 'asset.maint.add' }]
        },
        { id: 'asset.depreciation', label: 'Depreciation & Current Value', ref: '§2.5', type: 'depreciation', roles: ['superadmin', 'accountant', 'hr'], desc: 'Straight Line only today. Calculated automatically — never typed in. Missing Purchase Value or Useful Life shows "Not available" rather than guessing.' },
        {
          id: 'asset.requests', label: 'Asset Requests', ref: '§2.6', type: 'list', roles: ['superadmin', 'manager'], scope: { manager: 'team' },
          desc: 'Repair, Damage and Return requests raised by employees. Transfer is not a request type — it is an administrative action.',
          filters: [['All Statuses', 'Pending', 'Approved', 'Rejected', 'Completed'], ['All Types', 'Repair', 'Damage Report', 'Return'], ['All Requesters'].concat(PEOPLE)],
          filterNames: ['Status', 'Request Type', 'Requester'],
          columns: [{ k: 'emp', t: 'Employee', c: 'cell-strong', avatar: 1 }, { k: 'asset', t: 'Asset', c: 'mono' }, { k: 'type', t: 'Request Type', type: 'chip' }, { k: 'raised', t: 'Date Raised', c: 'mono' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'desc', t: 'Description' }],
          rows: 'assetRequests', empty: 'No pending requests.',
          rowActions: [{ l: 'Approve', c: 'ok' }, { l: 'Reject', c: 'no', go: 'asset.reqreject' }]
        },
        { id: 'asset.reports', label: 'Asset Reports', ref: '§2.7', type: 'report', roles: ['superadmin', 'accountant', 'hr', 'manager'], scope: { manager: 'team' }, report: 'asset', desc: 'Three views, one filter set. Every filter applies across all three simultaneously.' },
        {
          id: 'asset.reclaim', label: 'Reclaim on Exit', ref: '§2.8', type: 'list', roles: ['superadmin', 'hr'],
          desc: 'Triggered from the Offboarding checklist. Once every asset is returned or retired, the checklist item marks itself complete.',
          filters: [['Suresh Babu', 'Priya Varma'], ['All Categories', 'Desktop', 'Monitor', 'Access']],
          filterNames: ['Exiting Employee', 'Category'],
          columns: [{ k: 'tag', t: 'Asset Tag', c: 'mono cell-accent' }, { k: 'name', t: 'Name', c: 'cell-strong' }, { k: 'cat', t: 'Category' }, { k: 'assigned', t: 'Assigned Date', c: 'mono' }],
          rows: 'reclaim', empty: 'This employee has no assets currently assigned.',
          rowActions: [{ l: 'Mark Returned', c: 'ok', go: 'asset.markreturned' }, { l: 'Mark Damaged', c: 'no', go: 'asset.markreturned' }]
        },
        { id: 'asset.download', label: 'Download Asset Card', ref: '§2.9', type: 'assetcard', roles: ['superadmin', 'accountant', 'hr', 'manager'], desc: 'A single-page printable summary. Purchase and Current Value appear only for roles that can already see those fields.' },
        { id: 'asset.reqreject', navHidden: 1, label: 'Reject Asset Request', ref: '§2.6', type: 'form', form: 'a.reqreject', roles: ['superadmin','manager'], desc: 'Rejecting requires a short reason, shown back to the employee. The asset Status is left unchanged.' },
        { id: 'asset.maint.add', navHidden: 1, label: 'Add Maintenance Entry', ref: '§2.4', type: 'form', form: 'a.maint', roles: ['superadmin','accountant'], desc: 'Entries created by an approved repair request appear here too, marked system-generated.' },
        { id: 'asset.markreturned', navHidden: 1, label: 'Mark Returned', ref: '§2.8', type: 'form', form: 'a.reclaim', roles: ['superadmin','hr'], desc: 'Returned in working condition goes to In Store; not working goes to Retired-Disposed with a required reason.' }
      ]
    },

    /* ------------------------------------------------ OPERATIONS */
    {
      group: 'Operations', id: 'ticket', label: 'Ticket', icon: 'ticket', ref: 'Module 4',
      screens: [
        {
          id: 'ticket.list', label: 'Ticket List', ref: '§2.1', type: 'list',
          roles: ['superadmin', 'manager', 'employee'], scope: { employee: 'own' },
          desc: 'Super Admin and Manager see every ticket; Employee sees only tickets assigned to them. Accountant and HR have no access to this module at all.',
          filters: [['All Statuses', 'Open', 'In Progress', 'Resolved', 'Closed'], ['All Priorities', 'Urgent', 'High', 'Medium', 'Low'], ['All Categories', 'Access', 'Bug', 'Integration', 'Billing', 'Enhancement'], ['All Customers'].concat(CUSTOMERS), ['All Staff'].concat(PEOPLE)],
          filterNames: ['Status', 'Priority', 'Category', 'Customer', 'Assigned Staff'],
          hideFilterFor: { employee: [4] },
          columns: [{ k: 'no', t: 'Ticket #', c: 'mono cell-accent' }, { k: 'cust', t: 'Customer' }, { k: 'subj', t: 'Subject', c: 'cell-strong' }, { k: 'cat', t: 'Category' }, { k: 'pri', t: 'Priority', type: 'status' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'to', t: 'Assigned To' }, { k: 'raised', t: 'Raised', c: 'mono' }, { k: 'frt', t: 'First Response', c: 'mono' }],
          rows: 'tickets', rowGo: 'ticket.detail', empty: 'No tickets yet.',
          actions: [{ label: '+ New Ticket', primary: 1, roles: ['superadmin', 'manager'], go: 'ticket.new' }]
        },
        { id: 'ticket.new', label: 'New / Edit Ticket', ref: '§2.2', type: 'form', roles: ['superadmin', 'manager'], form: 'ticket', desc: 'Ticket Number auto-generates on save as TKT-<FY>-0000, using the prefix from Company Profile.' },
        { id: 'ticket.detail', label: 'Ticket Detail', ref: '§2.3', type: 'conversation', roles: ['superadmin', 'manager', 'employee'], scope: { employee: 'own' }, desc: 'The main working screen. Public Reply vs Internal Note must be an obvious, hard-to-miss control.' },
        { id: 'ticket.assign', label: 'Assign / Reassign', ref: '§2.4', type: 'form', roles: ['superadmin', 'manager'], form: 'reassign', desc: 'On save, Assigned To updates, both assignees are notified, and an Assignment History entry is recorded.' },
        { id: 'ticket.reports', label: 'Support Reports', ref: '§2.5', type: 'report', roles: ['superadmin', 'manager'], report: 'ticket', desc: 'Read-only. Every export carries a header block listing the filters that produced it.' },
        {
          id: 'emp.tickets', label: 'My Tickets', ref: 'Employee §2.7', type: 'list', roles: ALL, scope: { all: 'own' },
          desc: 'Support tickets currently assigned to this person, every role — still documented in the Employee module (§2.7), relocated here since it belongs with the rest of Ticket. Project shows the ticket’s Linked Project (§2.2) — — means the ticket was never linked to one.',
          filters: [['All Statuses', 'Open', 'In Progress', 'Resolved', 'Closed'], ['All Priorities', 'Urgent', 'High', 'Medium', 'Low'], ['All Projects'].concat(D.projects.map(p => p.name))],
          filterNames: ['Status', 'Priority', 'Project'],
          columns: [{ k: 'no', t: 'Ticket #', c: 'mono cell-accent' }, { k: 'cust', t: 'Customer' }, { k: 'subj', t: 'Subject', c: 'cell-strong' }, { k: 'proj', t: 'Project' }, { k: 'pri', t: 'Priority', type: 'status' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'raised', t: 'Raised', c: 'mono' }],
          rows: 'myTickets', rowGo: 'ticket.detail', empty: 'No tickets assigned to you — nice and clear.'
        },
        { id: 'ticket.close', navHidden: 1, label: 'Close Ticket', ref: '§2.3', type: 'form', form: 't.close', roles: ['superadmin','manager','employee'], desc: 'Moving Status to Closed opens an optional Satisfaction Rating prompt.' }
      ]
    },
    {
      group: 'Operations', id: 'project', label: 'Project', icon: 'project', ref: 'Module 10',
      screens: [
        {
          id: 'proj.directory', label: 'Project Directory', ref: '§2.1', type: 'list',
          roles: ['superadmin', 'manager', 'employee'], scope: { employee: 'own' },
          desc: 'Super Admin and Manager see every project; Employee sees only projects they are a team member on.',
          filters: [['All Customers'].concat(CUSTOMERS), ['All Statuses', 'Not Started', 'In Progress', 'On Hold', 'Completed'], ['All Leads'].concat(PEOPLE), FIN_PRESETS],
          filterNames: ['Customer', 'Status', 'Project Lead', 'Period'],
          columns: [{ k: 'code', t: 'Project Code', c: 'mono cell-accent' }, { k: 'name', t: 'Project Name', c: 'cell-strong' }, { k: 'cust', t: 'Customer' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'start', t: 'Start Date', c: 'mono' }, { k: 'end', t: 'End Date', c: 'mono' }, { k: 'lead', t: 'Project Lead' }, { k: 'budget', t: 'Budget', type: 'money', c: 'r', th: 'r' }],
          rows: 'projects', rowGo: 'proj.board', empty: 'No projects yet.',
          actions: [{ label: '+ Add Project', primary: 1, roles: ['superadmin', 'manager'], go: 'proj.edit' }]
        },
        { id: 'proj.edit', label: 'Add / Edit Project', ref: '§2.2', type: 'form', roles: ['superadmin', 'manager'], form: 'project', desc: 'Selecting an Opportunity that is not already Won sets it to Won automatically on save — Path B of the Won trigger.' },
        { id: 'proj.board', label: 'Task Board', ref: '§2.3', type: 'board', roles: ALL, board: 'tasks', desc: 'Filters apply to all five columns at once, and each column\'s count reflects the filtered set.' },
        { id: 'proj.task', label: 'Task Detail', ref: '§2.4', type: 'taskdetail', roles: ALL, desc: 'Comments are never edited or deleted once posted, only added to. Delete is Manager/Super Admin only.' },
        {
          id: 'proj.sprints', label: 'Sprints', ref: '§2.5', type: 'list', roles: ALL,
          desc: 'Any team member can view which sprint a task belongs to. Tasks column is a live count of tasks actually linked to that sprint — click a row to see them on the Task Board, filtered to that sprint. Start, Update and Complete are Manager/Super Admin only.',
          filters: [['All Statuses', 'Planned', 'Active', 'Completed']], filterNames: ['Status'],
          columns: [{ k: 'name', t: 'Sprint Name', c: 'cell-strong' }, { k: 'start', t: 'Start Date', c: 'mono' }, { k: 'end', t: 'End Date', c: 'mono' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'tasks', t: 'Tasks', c: 'mono r', th: 'r' }],
          rows: 'sprints', rowGo: 'proj.board', empty: 'No sprints yet.',
          actions: [{ label: 'Start Sprint', primary: 1, roles: ['superadmin', 'manager'], go: 'proj.sprintstart' }], rowActions: [{ l: 'Update', go: 'proj.sprintupdate' }, 'Complete']
        },
        { id: 'proj.bugs', label: 'Bugs', ref: '§2.6', type: 'board', roles: ALL, board: 'bugs', desc: 'A separate tracker from Tasks, kept visually distinct — every card shows its Severity as a colored badge.' },
        { id: 'proj.report', label: 'Project Report', ref: '§2.7', type: 'report', roles: ['superadmin', 'manager'], report: 'project', desc: 'Counts, not analytics. Still no charts and no trends — filtering a count is not the same as visualizing it.' },
        {
          id: 'proj.milestones', label: 'Milestones', ref: '§2.8', type: 'list', roles: ALL,
          desc: 'Reached is set manually; Missed is set automatically if the Target Date passes while still Upcoming.',
          filters: [['All Statuses', 'Upcoming', 'Reached', 'Missed']], filterNames: ['Status'],
          columns: [{ k: 'name', t: 'Milestone', c: 'cell-strong' }, { k: 'target', t: 'Target Date', c: 'mono' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'linked', t: 'Linked Tasks Done', c: 'mono' }],
          rows: 'milestones', empty: 'No milestones set for this project yet.',
          actions: [{ label: '+ Add Milestone', primary: 1, roles: ['superadmin', 'manager'] , go: 'proj.milestoneadd' }]
        },
        {
          id: 'proj.timesheets', label: 'Timesheets', ref: '§2.8', type: 'list', roles: ALL, scope: { employee: 'own' },
          desc: 'Every team member logs their own hours. Only Approved hours feed Payroll\'s planned hour-basis calculation.',
          filters: [['All People'].concat(PEOPLE), ['All Statuses', 'Draft', 'Submitted', 'Approved'], ['All Tasks'].concat(D.tasks.map(t => t.id))],
          filterNames: ['Person', 'Approval Status', 'Task'],
          hideFilterFor: { employee: [0] },
          columns: [{ k: 'date', t: 'Date', c: 'mono' }, { k: 'person', t: 'Person', c: 'cell-strong' }, { k: 'task', t: 'Task' }, { k: 'hours', t: 'Hours', c: 'mono r', th: 'r' }, { k: 'notes', t: 'Notes' }, { k: 'status', t: 'Status', type: 'status' }],
          rows: 'timesheet', empty: 'No hours logged yet.',
          actions: [{ label: '+ Log Hours', primary: 1 , go: 'proj.loghours' }], rowActions: [{ l: 'Approve', c: 'ok', roles: ['superadmin', 'manager'] }]
        },
        {
          id: 'emp.projects', label: 'My Projects & Tasks', ref: 'Employee §2.8', type: 'list', roles: ALL, scope: { all: 'own' },
          desc: 'Projects this person is a team member on, and the tasks assigned to them, every role — still documented in the Employee module (§2.8), relocated here since it belongs with the rest of Project.',
          filters: [['All Statuses', 'Backlog', 'To Do', 'In Progress', 'In Review', 'Done'], ['All Priorities', 'High', 'Medium', 'Low'], ['All Projects'].concat(D.projects.map(p => p.name))],
          filterNames: ['Status', 'Priority', 'Project'],
          columns: [{ k: 'id', t: 'Task ID', c: 'mono cell-accent' }, { k: 't', t: 'Title', c: 'cell-strong' }, { k: 'proj', t: 'Project' }, { k: 's', t: 'Status', type: 'status' }, { k: 'pri', t: 'Priority', type: 'status' }, { k: 'a', t: 'Assignee' }, { k: 'due', t: 'Due Date', c: 'mono' }],
          rows: 'tasks', rowGo: 'proj.task', empty: 'You\'re not assigned to any projects yet.'
        },
        { id: 'proj.sprintstart', navHidden: 1, label: 'Start Sprint', ref: '§2.5', type: 'form', form: 'pr.sprintstart', roles: ['superadmin','manager'], desc: 'Creates the sprint at Status = Active.' },
        { id: 'proj.sprintupdate', navHidden: 1, label: 'Update Sprint', ref: '§2.5', type: 'form', form: 'pr.sprintupdate', roles: ['superadmin','manager'], desc: 'Add or remove tasks from an Active sprint.' },
        { id: 'proj.bugadd', navHidden: 1, label: 'Report Bug', ref: '§2.6', type: 'form', form: 'pr.bug', roles: ['superadmin','manager','accountant','hr','employee'], desc: 'Severity drives the coloured badge that keeps a bug board visually distinct from a task board.' },
        { id: 'proj.milestoneadd', navHidden: 1, label: 'Add / Edit Milestone', ref: '§2.8', type: 'form', form: 'pr.milestone', roles: ['superadmin','manager'], desc: 'Reached is set manually; Missed is set automatically once Target Date passes.' },
        { id: 'proj.loghours', navHidden: 1, label: 'Log Hours', ref: '§2.8', type: 'form', form: 'pr.timesheet', roles: ['superadmin','manager','accountant','hr','employee'], desc: 'Only Approved hours feed Payroll\u2019s planned hour-basis calculation.' }
      ]
    },
    {
      group: 'Operations', id: 'opportunity', label: 'Opportunity', icon: 'opp', ref: 'Module 9',
      screens: [
        { id: 'opp.pipeline', label: 'Opportunity Pipeline', ref: '§2.1', type: 'pipeline', roles: ['superadmin', 'manager'], scope: { manager: 'team' }, desc: 'Table and Stage summary share one filter set, so stage counts and ₹ totals always reflect the same set the table would show.' },
        { id: 'opp.edit', navHidden: 1, label: 'Add / Edit Opportunity', ref: '§2.2', type: 'form', roles: ['superadmin', 'manager'], form: 'opportunity', desc: 'Probability auto-suggests on stage change (10/30/60/100/0) and stays manually editable. Moving to Lost prompts for a required Reason immediately.' },
        { id: 'opp.360', label: 'Opportunity Record', ref: '§2.3', type: 'record', roles: ['superadmin', 'manager'], scope: { manager: 'team' }, record: 'opportunity', desc: 'Details, Activities, and Files on the deal — Activities is a chronological timeline (Call/Email/Meeting/Note), Files holds documents like proposals and pricing sheets.' },
        { id: 'opp.activity', navHidden: 1, label: 'Add Activity', ref: '§2.3', type: 'form', form: 'opp.activity', roles: ['superadmin','manager'], desc: 'Type, Date, Description, and an optional Related Contact — logged most-recent-first on the Activities tab.' },
        { id: 'opp.lost', navHidden: 1, label: 'Mark Opportunity Lost', ref: '§2.2', type: 'form', form: 'o.lost', roles: ['superadmin','manager'], desc: 'The reason prompt fires the moment Stage becomes Lost and cannot be deferred.' }
      ]
    },
    {
      group: 'Operations', id: 'customer', label: 'Customer', icon: 'customer', ref: 'Module 8',
      screens: [
        {
          id: 'cust.directory', label: 'Customer Directory', ref: '§2.1', type: 'list',
          roles: ['superadmin', 'manager'], scope: { manager: 'team' },
          desc: 'Manager and Super Admin only. Accountant reaches customers solely through the Invoice-creation picker, never this page.',
          filters: [['All Statuses', 'Prospect', 'Active', 'Inactive'], ['All Owners', 'Meera Joshi', 'Divya Raman'], ['All Cities', 'Chennai', 'Bengaluru', 'Pune', 'Coimbatore'], ['All Sources'].concat(D.masters.customerSource.map(s => s.name))],
          filterNames: ['Status', 'Owner', 'City', 'Source'],
          columns: [{ k: 'code', t: 'Customer Code', c: 'mono cell-accent' }, { k: 'name', t: 'Company Name', c: 'cell-strong' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'owner', t: 'Owner' }, { k: 'source', t: 'Source', type: 'chip' }, { k: 'bname', t: 'Customer Bank Account Name' }, { k: 'bacc', t: 'Account Number', c: 'mono' }, { k: 'collect', t: 'Collected Into', hideFrom: ['manager'] }, { k: 'inv', t: 'Total Invoiced', type: 'money', c: 'r', th: 'r' }, { k: 'out', t: 'Outstanding', type: 'money', c: 'r', th: 'r' }],
          rows: 'customers', rowGo: 'cust.360', empty: 'No customers yet.',
          actions: [{ label: '+ Add Customer', primary: 1, go: 'cust.edit' }]
        },
        { id: 'cust.edit', label: 'Add / Edit Customer', ref: '§2.2', type: 'form', roles: ['superadmin', 'manager'], form: 'customer', desc: 'Customer Code auto-generates on save as CUST-<FY>-0000.' },
        { id: 'cust.360', label: 'Customer 360', ref: '§2.3', type: 'record', roles: ['superadmin', 'manager'], scope: { manager: 'team' }, record: 'customer', desc: 'The persistent header keeps Total Invoiced / Received / Outstanding in view no matter which tab is open.' },
        { id: 'cust.contact', navHidden: 1, label: 'Add / Edit Contact', ref: '§2.3', type: 'form', form: 'c.contact', roles: ['superadmin','manager'], desc: 'Only one contact per customer can be Primary; marking a new one un-marks the previous.' },
        { id: 'cust.activity', navHidden: 1, label: 'Add Activity', ref: '§2.3', type: 'form', form: 'c.activity', roles: ['superadmin','manager'], desc: 'Saving adds the entry to the top of the timeline. Logged By is auto-filled and never editable.' }
      ]
    },

    /* ------------------------------------------------ FINANCE */
    {
      group: 'Finance', id: 'invoice', label: 'Invoice', icon: 'invoice', ref: 'Module 11',
      screens: [
        { id: 'inv.dashboard', label: 'Invoice Dashboard', ref: '§2.1', type: 'invdash', roles: ['superadmin', 'accountant'], desc: 'Company-wide figures pulled from four other modules. Large numbers use lakh/thousand abbreviation; individual invoice records never do.' },
        {
          id: 'inv.list', label: 'Invoice List', ref: '§2.2', type: 'list', roles: ['superadmin', 'accountant'],
          desc: 'The overdue "list" is a filter on this same table, not a duplicate screen. The ageing bucket filter is what a receivables list is actually worked from.',
          filters: [['All Customers'].concat(CUSTOMERS), ['All Statuses', 'Draft', 'Sent', 'Part-Paid', 'Paid'], FIN_PRESETS, ['All Ageing Buckets', 'Current', '1–30', '31–60', '61–90', '90+']],
          filterNames: ['Customer', 'Status', 'Period', 'Ageing Bucket'],
          columns: [{ k: 'no', t: 'Invoice Number', c: 'mono cell-accent' }, { k: 'cust', t: 'Customer', c: 'cell-strong' }, { k: 'total', t: 'Total', type: 'money', c: 'r', th: 'r' }, { k: 'paid', t: 'Paid', type: 'money', c: 'r', th: 'r' }, { k: 'wh', t: 'Withheld', type: 'money' }, { k: 'settled', t: 'Settled', type: 'money' }, { k: 'bal', t: 'Balance', type: 'money', c: 'r', th: 'r' }, { k: 'acc', t: 'Bank Account' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'due', t: 'Due Date', c: 'mono' }, { k: 'age', t: 'Ageing', type: 'chip' }],
          rows: 'invoices', rowGo: 'inv.edit', empty: 'No invoices yet.',
          actions: [{ label: '+ New Invoice', primary: 1, go: 'inv.edit' }]
        },
        { id: 'inv.edit', label: 'New / Edit Invoice', ref: '§2.3', type: 'document', roles: ['superadmin', 'accountant'], doc: 'invoice', desc: 'Once Status reaches Paid the invoice locks — every field becomes read-only, and corrections go through a Credit Note instead.' },
        { id: 'inv.payment', label: 'Record Payment', ref: '§2.4', type: 'form', roles: ['superadmin', 'accountant'], form: 'payment', desc: 'Available only on an invoice with Status Sent or Part-Paid. Amount cannot exceed Balance Due.' },
        { id: 'inv.creditnote', label: 'Raise Credit Note', ref: '§2.5', type: 'form', roles: ['superadmin', 'accountant'], form: 'creditnote', desc: 'A Credit Note never edits the original invoice. It reduces what is owed; it does not move money.' },
        {
          id: 'inv.cnlist', label: 'Credit Note List', ref: '§2.5', type: 'list', roles: ['superadmin', 'accountant'],
          desc: '"Pending Approval" is the filter this list exists for — an unapproved credit note means an invoice balance is still overstated.',
          filters: [['All Customers'].concat(CUSTOMERS), ['All Statuses', 'Draft', 'Pending Approval', 'Approved'], ['All Reasons', 'Billing Error', 'Customer Dispute', 'Goods or Service Not Delivered', 'Other']],
          filterNames: ['Customer', 'Status', 'Reason'],
          columns: [{ k: 'no', t: 'Credit Note #', c: 'mono cell-accent' }, { k: 'inv', t: 'Original Invoice', c: 'mono' }, { k: 'cust', t: 'Customer', c: 'cell-strong' }, { k: 'reason', t: 'Reason' }, { k: 'amt', t: 'Credit Amount', type: 'money', c: 'r', th: 'r' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'by', t: 'Raised By' }, { k: 'appr', t: 'Approved By' }, { k: 'date', t: 'Date', c: 'mono' }],
          rows: 'creditNotes', rowGo: 'inv.creditnote', empty: 'No credit notes raised yet.'
        }
      ]
    },
    {
      group: 'Finance', id: 'expense', label: 'Expense', icon: 'expense', ref: 'Module 12',
      screens: [
        {
          id: 'exp.my', label: 'My Expenses', ref: '§2.1', type: 'list', roles: ALL, scope: { all: 'own' },
          desc: 'Status is never set by the person submitting — it defaults to Pending and only changes when someone with approval rights acts on it.',
          filters: [['All Types', 'Travel', 'Meals', 'Software', 'Stationery', 'Training'], ['All Statuses', 'Pending', 'Approved', 'Reimbursed', 'Rejected'], ['All Vendors'].concat(VENDORS), ['All Accounts'].concat(BANKS), ['Receipt — Any', 'Yes', 'No']],
          filterNames: ['Type', 'Status', 'Vendor', 'Bank Account', 'Has Receipt'],
          columns: [{ k: 'type', t: 'Type', c: 'cell-strong' }, { k: 'vendor', t: 'Vendor' }, { k: 'desc', t: 'Description' }, { k: 'bill', t: 'Linked Purchase Bill', c: 'mono' }, { k: 'amt', t: 'Amount', type: 'money', c: 'r', th: 'r' }, { k: 'acc', t: 'Bank Account' }, { k: 'date', t: 'Date', c: 'mono' }, { k: 'rcpt', t: 'Receipt', type: 'status' }, { k: 'status', t: 'Status', type: 'status' }],
          rows: 'myExpenses', empty: 'No expenses submitted yet.',
          actions: [{ label: '+ Add Expense', primary: 1 , go: 'exp.add' },
          { label: 'Export Statement', icon: 'download', toast: 'Bank-statement style export of the filtered rows — Date, Description, Bank Account, Debit, Running Balance — so a claim history can be reconciled line-by-line against the real account statement. Follows the filters currently applied, like every export.' }]
        },
        {
          id: 'exp.approvals', label: 'Expense Approvals', ref: '§2.2', type: 'list', roles: ['superadmin', 'accountant'],
          desc: 'Approve means reviewed and accepted — distinct from money having actually moved. Rejection requires a reason.',
          filters: [['All Employees'].concat(PEOPLE), DEPTS, ['All Types', 'Travel', 'Meals', 'Software', 'Stationery', 'Internet / Wi-Fi', 'Electricity', 'Office Rent', 'Cloud Hosting'], ['All Claim Types', 'Reimbursable', 'Company-Paid'], ['All Accounts'].concat(BANKS), ['Receipt — Any', 'Yes', 'No']],
          filterNames: ['Employee', 'Department', 'Type', 'Claim Type', 'Bank Account', 'Has Receipt'],
          columns: [{ k: 'emp', t: 'Employee', c: 'cell-strong', avatar: 1 }, { k: 'type', t: 'Type' }, { k: 'kind', t: 'Claim Type', type: 'chip' }, { k: 'vendor', t: 'Vendor' }, { k: 'bill', t: 'Linked Purchase Bill', c: 'mono' }, { k: 'amt', t: 'Amount', type: 'money', c: 'r', th: 'r' }, { k: 'acc', t: 'Bank Account' }, { k: 'date', t: 'Date', c: 'mono' }, { k: 'rcpt', t: 'Receipt', type: 'status' }, { k: 'status', t: 'Status', type: 'status' }],
          rows: 'allExpenses', empty: 'No pending expenses.',
          actions: [{ label: 'Export Statement', icon: 'download', toast: 'Bank-statement style export of the filtered rows — Date, Description, Bank Account, Debit, Running Balance. Filter to one account first and it reconciles directly against that account\'s real statement.' }],
          rowActions: [{ l: 'Approve', c: 'ok' }, { l: 'Reject', c: 'no', go: 'exp.reject' }]
        },
        {
          id: 'exp.all', label: 'All Expenses / Summary', ref: '§2.3', type: 'expsummary', roles: ['superadmin', 'accountant'],
          desc: 'Reimbursed is a distinct step from Approved — it records that a real payment happened, it does not move money itself.'
        },
        {
          id: 'exp.company', label: 'Company Expenses', ref: '§2.4', type: 'list', roles: ['superadmin', 'accountant'],
          desc: 'The company\'s own running bills — Wi-Fi, electricity, office rent, telephone, cloud hosting. These are Company-Paid expense types: Meshrd was billed directly, so nobody is owed a reimbursement and none of these rows ever reach the reimbursement queue. They are settled straight from a company bank account, which is why Bank Account matters more here than on a staff claim. Recurring marks the bills expected every month — filter on it to see at a glance whether one has not arrived.',
          filters: [['All Types', 'Internet / Wi-Fi', 'Electricity', 'Office Rent', 'Telephone / Mobile', 'Cloud Hosting', 'Housekeeping'], ['All Statuses', 'Pending', 'Approved', 'Reimbursed', 'Rejected'], ['All Vendors'].concat(VENDORS), ['All Accounts'].concat(BANKS), FIN_PRESETS],
          filterNames: ['Type', 'Status', 'Vendor', 'Bank Account', 'Period'],
          columns: [{ k: 'type', t: 'Expense Type', c: 'cell-strong' }, { k: 'vendor', t: 'Vendor' }, { k: 'bill', t: 'Linked Purchase Bill', c: 'mono' }, { k: 'amt', t: 'Amount', type: 'money', c: 'r', th: 'r' }, { k: 'acc', t: 'Paid From (Bank Account)' }, { k: 'date', t: 'Date', c: 'mono' }, { k: 'rcpt', t: 'Bill Attached', type: 'status' }, { k: 'status', t: 'Status', type: 'status' }],
          rows: () => D.allExpenses.filter(e => e.kind === 'Company-Paid'), empty: 'No company expenses recorded yet.',
          actions: [{ label: '+ Add Company Expense', primary: 1, go: 'exp.add' },
          { label: 'Export Statement', icon: 'download', toast: 'Bank-statement style export of the filtered rows — Date, Description, Bank Account, Debit, Running Balance — so the month\'s running bills reconcile line-by-line against the real account statement.' }]
        },
        { id: 'exp.add', navHidden: 1, label: 'Add Expense', ref: '§2.1', type: 'form', form: 'x.add', roles: ['superadmin','manager','accountant','hr','employee'], desc: 'Status is never set by the person submitting — it defaults to Pending. The Type dropdown is what decides the rest: a Reimbursable type ends in a payout to the claimant, a Company-Paid type (Wi-Fi, rent, hosting) is settled straight from the company account and is listed only for Super Admin and Accountant.' },
        { id: 'exp.reject', navHidden: 1, label: 'Reject Expense', ref: '§2.2', type: 'form', form: 'x.reject', roles: ['superadmin','accountant'], desc: 'Rejection requires a reason.' },
        { id: 'exp.reimburse', navHidden: 1, label: 'Mark as Reimbursed', ref: '§2.3', type: 'form', form: 'x.reimburse', roles: ['superadmin','accountant'], desc: 'A manual confirmation that a real payment happened — this module does not move money.' }
      ]
    },
    {
      group: 'Finance', id: 'purchasebill', label: 'Purchase Bill', icon: 'purchase', ref: 'Module 13',
      screens: [
        {
          id: 'pb.list', label: 'Purchase Bill List', ref: '§2.1', type: 'list', roles: ['superadmin', 'accountant'],
          desc: 'Ageing matters as much on the payables side as on receivables — arguably more, since a late supplier bill damages a relationship the company depends on.',
          filters: [['All Vendors'].concat(VENDORS), ['All Statuses', 'Unpaid', 'Part-Paid', 'Paid'], FIN_PRESETS, ['All Ageing Buckets', 'Current', '1–30', '31–60', '61–90', '90+'], ['All Accounts'].concat(BANKS)],
          filterNames: ['Supplier', 'Status', 'Period', 'Ageing Bucket', 'Bank Account'],
          columns: [{ k: 'id', t: 'Internal Bill ID', c: 'mono cell-accent' }, { k: 'vendor', t: 'Vendor', c: 'cell-strong' }, { k: 'vno', t: "Vendor's Bill Number", c: 'mono' }, { k: 'total', t: 'Total', type: 'money' }, { k: 'wh', t: 'Withholding', type: 'money' }, { k: 'net', t: 'Payable to Vendor', type: 'money' }, { k: 'paid', t: 'Paid', type: 'money' }, { k: 'acc', t: 'Bank Account' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'bdate', t: 'Bill Date', c: 'mono' }, { k: 'due', t: 'Due Date', c: 'mono' }],
          rows: 'bills', rowGo: 'pb.edit', empty: 'No purchase bills recorded yet.',
          actions: [{ label: '+ Add Purchase Bill', primary: 1, go: 'pb.edit' }]
        },
        { id: 'pb.edit', label: 'Add / Edit Purchase Bill', ref: '§2.2', type: 'document', roles: ['superadmin', 'accountant'], doc: 'bill', desc: 'Two different bill numbers, kept clearly separate: Meshrd\'s internal PB ID, and the vendor\'s own bill number printed on their document.' },
        { id: 'pb.payment', label: 'Record Payment', ref: '§2.3', type: 'form', roles: ['superadmin', 'accountant'], form: 'billpayment', desc: 'Available only on a bill with Status Unpaid or Part-Paid. Multiple partial payments are supported.' }
      ]
    },
    {
      /* Tax & Compliance — screens live in the Finance sidebar group but are OWNED by
         the Purchase Bill spec as its new Section 8. Deliberately not a 15th module:
         RBAC §3 allows sidebar position and spec ownership to diverge, and a 15th
         module was added and removed once already for owning nothing of its own. */
      group: 'Finance', id: 'taxcompliance', label: 'Tax & Compliance', icon: 'rupee', ref: 'Module 15',
      screens: [
        {
          id: 'tax.overview', label: 'Tax & Compliance Overview', ref: '§2.1', type: 'taxoverview', roles: ['superadmin', 'accountant'],
          desc: 'Both directions in one place, shown as two panels that are never netted into a single figure. What the company withheld from suppliers is a liability owed onward to an authority; what customers withheld from the company is an asset claimable back. A single "net tax position" number would be wrong in both directions.'
        },
        {
          id: 'tax.payable', label: 'Withheld on Payments', ref: '§2.2', type: 'list', roles: ['superadmin', 'accountant'],
          desc: 'Per tax head, per remittance period: what was withheld from suppliers against what has actually been handed to the authority. Outstanding is the money the company is holding on someone else’s behalf.',
          filters: [['All Heads'].concat(D.masters.taxHeads.filter(t => t.onward === 'Yes').map(t => t.name)), ['All Sources', 'Vendor', 'Employee'], ['All Statuses', 'Open', 'Due Soon', 'Overdue', 'Part-Remitted', 'Remitted'], FIN_PRESETS, ['Overdue — Any', 'Yes', 'No']],
          filterNames: ['Tax Head', 'Source', 'Status', 'Period', 'Overdue Only'],
          columns: [{ k: 'head', t: 'Tax Head', c: 'cell-strong' }, { k: 'src', t: 'Source', type: 'chip' }, { k: 'authority', t: 'Remitted To' }, { k: 'label', t: 'Period' }, { k: 'from', t: 'Period From', c: 'mono' }, { k: 'to', t: 'Period To', c: 'mono' }, { k: 'docs', t: 'Documents', c: 'r num', th: 'r' }, { k: 'withheld', t: 'Withheld', type: 'money' }, { k: 'remitted', t: 'Remitted', type: 'money' }, { k: 'outstanding', t: 'Outstanding', type: 'money' }, { k: 'due', t: 'Due Date', c: 'mono' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'ref', t: 'Authority Reference', c: 'mono' }],
          rows: 'taxPeriods', empty: 'Nothing has been withheld yet. A withholding tax selected on a Purchase Bill (Module 13, Section 2.2) appears here automatically, in the period its Bill Date falls in.',
          actions: [{ label: 'Export', icon: 'download', toast: 'Exports exactly the filtered periods, with a header block naming the filters applied.' }],
          rowActions: [{ l: 'Record Remittance', c: 'ok', go: 'tax.remit', roles: ['superadmin', 'accountant'] }]
        },
        {
          id: 'tax.docs', label: 'Withheld — By Document', ref: '§2.3', type: 'list', roles: ['superadmin', 'accountant'],
          desc: 'The drill-down behind each period: one row per purchase bill carrying withholding, so a period total can always be traced back to the bills that produced it.',
          filters: [['All Heads'].concat(D.masters.taxHeads.filter(t => t.onward === 'Yes').map(t => t.name)), ['All Sources', 'Vendor', 'Employee'], ['All Periods', 'Jul 2026', 'Jun 2026'], ['Remittance — Any', 'Remitted', 'Not Remitted']],
          filterNames: ['Tax Head', 'Source', 'Period', 'Remittance Status'],
          columns: [{ k: 'doc', t: 'Document', c: 'mono cell-accent' }, { k: 'src', t: 'Source', type: 'chip' }, { k: 'party', t: 'Counterparty', c: 'cell-strong' }, { k: 'date', t: 'Date', c: 'mono' }, { k: 'head', t: 'Tax Head' }, { k: 'base', t: 'Calculated On' }, { k: 'total', t: 'Document Total', type: 'money' }, { k: 'withheld', t: 'Withheld', type: 'money' }, { k: 'net', t: 'Net Paid', type: 'money' }, { k: 'period', t: 'Remittance Period' }, { k: 'rstatus', t: 'Remittance Status', type: 'status' }, { k: 'ref', t: 'Authority Reference', c: 'mono' }],
          rows: 'taxWithheldDocs', empty: 'Nothing has been withheld yet.'
        },
        {
          id: 'tax.remittances', label: 'Remittances', ref: '§2.4', type: 'list', roles: ['superadmin', 'accountant'],
          desc: 'Every remittance actually handed to the authority. A remittance is never editable after save — a wrong one is corrected by a reversal that references the original, the same principle a Credit Note applies to a locked invoice.',
          filters: [['All Heads'].concat(D.masters.taxHeads.filter(t => /Withholding/.test(t.scope)).map(t => t.name)), ['All Periods', 'Jul 2026', 'Jun 2026', 'May 2026'], ['All Accounts'].concat(BANKS), ['All Modes'].concat(D.masters.paymentMode.map(m => m.name))],
          filterNames: ['Tax Head', 'Period', 'Paid From', 'Mode'],
          columns: [{ k: 'id', t: 'Remittance ID', c: 'mono cell-accent' }, { k: 'head', t: 'Tax Head', c: 'cell-strong' }, { k: 'authority', t: 'Remitted To' }, { k: 'period', t: 'Period' }, { k: 'amt', t: 'Amount Remitted', type: 'money' }, { k: 'on', t: 'Paid On', c: 'mono' }, { k: 'from', t: 'Paid From' }, { k: 'mode', t: 'Mode', type: 'chip' }, { k: 'ref', t: 'Authority Reference', c: 'mono' }, { k: 'docs', t: 'Documents Covered', c: 'r num', th: 'r' }, { k: 'by', t: 'Recorded By' }],
          rows: 'taxRemittances', empty: 'No remittance recorded yet.',
          rowActions: [{ l: 'Reverse', c: 'no', roles: ['superadmin'] }]
        },
        {
          id: 'tax.receivable', label: 'Withheld from Receipts', ref: '§2.6', type: 'list', roles: ['superadmin', 'accountant'],
          desc: 'What customers held back from what they paid, the certificates that evidence it, and whether the credit has been claimed. This is an asset the company can claim — not a loss, and never a Credit Note.',
          filters: [['All Customers'].concat(CUSTOMERS), ['All Statuses', 'Awaiting Certificate', 'Certified — Unclaimed', 'Claimed', 'Not Expected', 'Variance'], ['Certificate — Any', 'Yes', 'No'], ['Claimed — Any', 'Yes', 'No']],
          filterNames: ['Customer', 'Status', 'Certificate Received', 'Credit Claimed'],
          columns: [{ k: 'inv', t: 'Invoice Number', c: 'mono cell-accent' }, { k: 'cust', t: 'Customer', c: 'cell-strong' }, { k: 'date', t: 'Payment Date', c: 'mono' }, { k: 'total', t: 'Invoice Total', type: 'money' }, { k: 'received', t: 'Amount Received', type: 'money' }, { k: 'withheld', t: 'Withheld', type: 'money' }, { k: 'cert', t: 'Certificate', type: 'status' }, { k: 'certref', t: 'Certificate Ref', c: 'mono' }, { k: 'claimed', t: 'Credit Claimed', type: 'status' }, { k: 'status', t: 'Status', type: 'status' }],
          rows: 'taxReceipts', empty: 'No customer has withheld tax from a payment yet. Withholding recorded on Invoice → Record Payment (Module 11, Section 2.4) appears here automatically.',
          actions: [{ label: 'Export', icon: 'download', toast: 'Exports exactly the filtered receipts.' }],
          rowActions: [{ l: 'Log Certificate', go: 'tax.cert', roles: ['superadmin', 'accountant'] }, { l: 'Mark Claimed', c: 'ok', go: 'tax.claim', roles: ['superadmin', 'accountant'] }]
        },
        {
          id: 'tax.certificates', label: 'Certificates', ref: '§2.7', type: 'list', roles: ['superadmin', 'accountant'],
          desc: 'One row per certificate logged. Where a certificate states a different figure than the receipts it covers, the variance is shown rather than hidden — and the CERTIFIED amount is what may be claimed, because that is what the authority will accept.',
          filters: [['All Customers'].concat(CUSTOMERS), ['All Statuses', 'Matched', 'Variance', 'Voided'], FIN_PRESETS, ['Variance — Any', 'Yes', 'No']],
          filterNames: ['Customer', 'Status', 'Period', 'Has Variance'],
          columns: [{ k: 'ref', t: 'Certificate Reference', c: 'mono cell-accent' }, { k: 'cust', t: 'Customer', c: 'cell-strong' }, { k: 'cdate', t: 'Certificate Date', c: 'mono' }, { k: 'from', t: 'Covered From', c: 'mono' }, { k: 'to', t: 'Covered To', c: 'mono' }, { k: 'stated', t: 'Amount on Certificate', type: 'money' }, { k: 'matched', t: 'Amount Matched', type: 'money' }, { k: 'variance', t: 'Variance', type: 'money' }, { k: 'receipts', t: 'Receipts Covered', c: 'r num', th: 'r' }, { k: 'status', t: 'Status', type: 'status' }],
          rows: 'taxCertificates', empty: 'No certificate logged yet.',
          rowActions: [{ l: 'Void', c: 'no', roles: ['superadmin'] }]
        },
        { id: 'tax.remit', navHidden: 1, label: 'Record Remittance', ref: '§2.5', type: 'form', form: 'tax.remit', roles: ['superadmin', 'accountant'], desc: 'Records money actually handed to the authority for one head and one period. Never editable after save — corrections go through a reversal that references the original.' },
        { id: 'tax.cert', navHidden: 1, label: 'Log Withholding Certificate', ref: '§2.8', type: 'form', form: 'tax.cert', roles: ['superadmin', 'accountant'], desc: 'Logs the certificate a customer issues as evidence of what they withheld. Where its figure differs from ours, the certified figure governs.' },
        { id: 'tax.claim', navHidden: 1, label: 'Mark Credit Claimed', ref: '§2.9', type: 'form', form: 'tax.claim', roles: ['superadmin', 'accountant'], desc: 'Closes the loop: records that a certified withholding credit has been claimed against the company’s own liability.' }
      ]
    },
    {
      group: 'Finance', id: 'vendor', label: 'Vendor', icon: 'vendor', ref: 'Module 7',
      screens: [
        {
          id: 'vendor.directory', label: 'Vendor Directory', ref: '§2.1', type: 'list', roles: ['superadmin', 'accountant', 'manager'],
          desc: 'Employee and HR have no access — there is no personal reason a staff member needs to see supplier bank or tax details.',
          filters: [['All Statuses', 'Active', 'Inactive'], ['All Cities', 'Chennai', 'Coimbatore', 'Bengaluru'], ['All Payment Terms', '7 days', '15 days', '30 days', '45 days'], ['Bank Details — Any', 'Yes', 'No']],
          filterNames: ['Status', 'City', 'Payment Terms', 'Has Bank Details'],
          hideFilterFor: { manager: [3] },
          columns: [{ k: 'name', t: 'Vendor Name', c: 'cell-strong' }, { k: 'gstin', t: 'GSTIN', c: 'mono', hideFrom: ['manager'] }, { k: 'phone', t: 'Contact Phone', c: 'mono' }, { k: 'email', t: 'Contact Email' }, { k: 'terms', t: 'Payment Terms' }, { k: 'bname', t: 'Bank Account Name', hideFrom: ['manager'] }, { k: 'bbank', t: 'Bank', hideFrom: ['manager'] }, { k: 'bacc', t: 'Account Number', c: 'mono', hideFrom: ['manager'] }, { k: 'status', t: 'Status', type: 'status' }],
          rows: 'vendors', rowGo: 'vendor.edit', empty: 'No vendors yet — they\'re often added directly from a Purchase Bill or Expense instead.',
          actions: [{ label: '+ Add Vendor', primary: 1, go: 'vendor.edit' }]
        },
        { id: 'vendor.edit', label: 'Add / Edit Vendor', ref: '§2.2', type: 'record', roles: ['superadmin', 'accountant', 'manager'], record: 'vendor', desc: 'A vendor with any usage history can only be Deactivated, never deleted. Bank and GST fields are Accountant/Super-Admin-only by default.' },
        {
          id: 'vendor.usage', label: 'Vendor Usage', ref: '§2.3', type: 'list', roles: ['superadmin', 'accountant', 'manager'],
          desc: 'Read-only, and deliberately still no totals and no charts — spend reporting belongs to Purchase Bill and Expense.',
          filters: [['All Types', 'Purchase Bill', 'Expense'], ['All Statuses', 'Unpaid', 'Part-Paid', 'Paid', 'Approved'], FIN_PRESETS, ['All Paid-From Accounts'].concat(BANKS)],
          filterNames: ['Type', 'Status', 'Period', 'Paid From'],
          columns: [{ k: 'type', t: 'Type', type: 'chip' }, { k: 'ref', t: 'Reference Number', c: 'mono cell-accent' }, { k: 'date', t: 'Date', c: 'mono' }, { k: 'amt', t: 'Amount', type: 'money', c: 'r', th: 'r' }, { k: 'mode', t: 'Mode' }, { k: 'acc', t: 'Paid From (Meshrd Account)', hideFrom: ['manager'] }, { k: 'vacc', t: "Paid Into (Vendor's Account Name)", hideFrom: ['manager'] }, { k: 'vaccno', t: 'Account Number', c: 'mono', hideFrom: ['manager'] }, { k: 'status', t: 'Status', type: 'status' }],
          rows: 'vendorUsage', empty: 'No usage yet — this vendor can be safely deleted if no longer needed.'
        }
      ]
    },

    /* ------------------------------------------------ ADMINISTRATION */
    {
      group: 'Administration', id: 'masters', label: 'Masters', icon: 'masters', ref: 'Module 1',
      screens: [
        {
          id: 'masters.fy', label: 'Financial Year', ref: '§3.1', type: 'list', roles: ['superadmin'],
          desc: 'A locked financial year is frozen for everyone, including the Super Admin who locked it.',
          filters: [['All Statuses', 'Active', 'Inactive'], ['Locked — Any', 'Yes', 'No']], filterNames: ['Status', 'Locked'],
          columns: [{ k: 'name', t: 'Financial Year', c: 'cell-strong' }, { k: 'from', t: 'From', c: 'mono' }, { k: 'to', t: 'To', c: 'mono' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'locked', t: 'Locked', type: 'status' }],
          rows: () => D.masters.fy, empty: 'No financial years configured.',
          actions: [{ label: '+ Add Financial Year', primary: 1, go: 'masters.fy.add' }], rowActions: ['Edit', 'Lock']
        },
        {
          id: 'masters.fy.add', label: 'Add Financial Year', ref: '§3.1', type: 'form', form: 'financialyear', roles: ['superadmin'],
          desc: 'Only a Start Date is entered — the Label and End Date are derived automatically and shown as a preview before saving.'
        },
        { id: 'masters.taxes', label: 'Taxes', ref: '§3.2', type: 'record', roles: ['superadmin', 'accountant'], record: 'taxes', desc: 'One dynamic list where Super Admin defines every tax this company actually applies. Nothing is pre-set and no tax is named anywhere in the specification.' },
        {
          id: 'masters.expensetypes', label: 'Expense Types', ref: '§3.3', type: 'list', roles: ['superadmin', 'manager'],
          desc: 'Manager can add and edit; Delete and Deactivate stay Super Admin only, as on every sub-master. Claim Type is the field that decides who may raise the expense: Reimbursable types are open to every employee and end in a payout to that person; Company-Paid types (Wi-Fi, rent, hosting) are the company\'s own running bills, are raised only by Super Admin or Accountant, and never enter the reimbursement queue.',
          filters: [['Active', 'Inactive', 'All Statuses'], ['All Claim Types', 'Reimbursable', 'Company-Paid'], ['Recurring — Any', 'Yes', 'No'], ['Used — Any', 'Yes', 'No']],
          filterNames: ['Status', 'Claim Type', 'Recurring', 'Used'],
          columns: [{ k: 'name', t: 'Expense Type', c: 'cell-strong' }, { k: 'code', t: 'Code', c: 'mono' }, { k: 'kind', t: 'Claim Type', type: 'chip' }, { k: 'recur', t: 'Recurring', type: 'status' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'used', t: 'Used', type: 'status' }],
          rows: () => D.masters.expenseTypes, empty: 'No expense types configured.',
          actions: [{ label: '+ Add Expense Type', primary: 1 , go: 'masters.expensetypes.add' }], rowActions: ['Edit', { l: 'Deactivate', roles: ['superadmin'] }]
        },
        {
          id: 'masters.leavetypes', label: 'Leave Types', ref: '§3.4', type: 'list', roles: ['superadmin', 'manager', 'hr'],
          desc: 'A quota of 0 means the type does not consume a balance — Remaining shows "Not tracked" on My Leave.',
          filters: [['Active', 'Inactive', 'All Statuses'], ['Carry Forward — Any', 'Yes', 'No']], filterNames: ['Status', 'Carry Forward'],
          columns: [{ k: 'name', t: 'Leave Type', c: 'cell-strong' }, { k: 'code', t: 'Code', c: 'mono' }, { k: 'quota', t: 'Default Annual Quota', c: 'mono r', th: 'r' }, { k: 'cf', t: 'Carry Forward', type: 'status' }, { k: 'maxcf', t: 'Max Carry Forward', c: 'mono r', th: 'r' }, { k: 'status', t: 'Status', type: 'status' }],
          rows: () => D.masters.leaveTypes, empty: 'No leave types configured.',
          actions: [{ label: '+ Add Leave Type', primary: 1 , go: 'masters.leavetypes.add' }], rowActions: ['Edit', { l: 'Deactivate', roles: ['superadmin'] }]
        },
        { id: 'masters.workweek', label: 'Work Week & Hours', ref: '§3.20', type: 'record', roles: ['superadmin', 'hr', 'manager'], scope: { hr: 'view', manager: 'view' }, record: 'workweek', desc: 'Hours per day, the break, the weekly target and the Saturday rule — all dynamic. Nothing here is hard-coded: the odd/even Saturday pattern, the grace window and the shortfall treatment are whatever Super Admin configures. Payroll and Leave both read this screen.' },
        { id: 'masters.holidays', label: 'Holidays', ref: '§3.5', type: 'calendar', roles: ['superadmin', 'manager'], editable: 1, desc: 'The company holiday calendar. Mandatory holidays are excluded from working-day counts in Leave and Payroll — and they override a working Saturday.' },
        { id: 'masters.company', label: 'Company Profile', ref: '§3.6', type: 'record', roles: ['superadmin', 'manager'], scope: { manager: 'view' }, record: 'company', desc: 'Meshrd\'s own official details, addresses, bank info, documents and numbering rules. Manager is view-only.' },
        {
          id: 'masters.paymentmode', label: 'Payment Mode', ref: '§3.8', type: 'list', roles: ['superadmin'],
          filters: [['Active', 'Inactive', 'All Statuses'], ['Used — Any', 'Yes', 'No']], filterNames: ['Status', 'Used'],
          columns: [{ k: 'name', t: 'Payment Mode', c: 'cell-strong' }, { k: 'code', t: 'Code', c: 'mono' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'used', t: 'Used', type: 'status' }],
          rows: () => D.masters.paymentMode, empty: 'No payment modes configured.', actions: [{ label: '+ Add Payment Mode', primary: 1 , go: 'masters.paymentmode.add' }]
        },
        {
          id: 'masters.department', label: 'Department', ref: '§3.9', type: 'list', roles: ['superadmin'],
          filters: [['Active', 'Inactive', 'All Statuses'], ['Used — Any', 'Yes', 'No']], filterNames: ['Status', 'Used'],
          columns: [{ k: 'name', t: 'Department', c: 'cell-strong' }, { k: 'code', t: 'Code', c: 'mono' }, { k: 'head', t: 'Department Head' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'used', t: 'Used', type: 'status' }],
          rows: () => D.masters.department, empty: 'No departments configured.', actions: [{ label: '+ Add Department', primary: 1 , go: 'masters.department.add' }]
        },
        {
          id: 'masters.designation', label: 'Designation / Job Title', ref: '§3.10', type: 'list', roles: ['superadmin'],
          filters: [['Active', 'Inactive', 'All Statuses'], ['Used — Any', 'Yes', 'No']], filterNames: ['Status', 'Used'],
          columns: [{ k: 'name', t: 'Designation', c: 'cell-strong' }, { k: 'code', t: 'Code', c: 'mono' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'used', t: 'Used', type: 'status' }],
          rows: () => D.masters.designation, empty: 'No designations configured.', actions: [{ label: '+ Add Designation', primary: 1 , go: 'masters.designation.add' }]
        },
        {
          id: 'masters.hsn', label: 'HSN / SAC Code', ref: '§3.11', type: 'list', roles: ['superadmin'],
          desc: 'Each code optionally links to a real, editable tax head from Masters → Taxes — never a fixed label. One code can carry IGST, another CGST+SGST, another a different rate entirely, because that is how HSN/SAC linkage actually works. Applied per line item, not per document, and the rate changes by editing the linked tax head in Taxes, not this row.',
          filters: [['Active', 'Inactive', 'All Statuses'], ['All Tax Heads'].concat(D.masters.taxHeads.filter(h => /Sales|Purchase/.test(h.scope)).map(h => h.name))], filterNames: ['Status', 'Linked Tax'],
          columns: [{ k: 'code', t: 'HSN / SAC', c: 'mono cell-accent' }, { k: 'desc', t: 'Description', c: 'cell-strong' }, { k: 'tax', t: 'Linked Tax Head' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'used', t: 'Used', type: 'status' }],
          rows: () => D.masters.hsn, empty: 'No HSN/SAC codes configured.', actions: [{ label: '+ Add Code', primary: 1 , go: 'masters.hsn.add' }]
        },
        {
          id: 'masters.servicecategory', label: 'Service Category', ref: '§3.12', type: 'list', roles: ['superadmin'],
          filters: [['Active', 'Inactive', 'All Statuses'], ['Used — Any', 'Yes', 'No']], filterNames: ['Status', 'Used'],
          columns: [{ k: 'name', t: 'Service Category', c: 'cell-strong' }, { k: 'code', t: 'Code', c: 'mono' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'used', t: 'Used', type: 'status' }],
          rows: () => D.masters.serviceCategory, empty: 'No service categories configured.', actions: [{ label: '+ Add Service Category', primary: 1 , go: 'masters.servicecategory.add' }]
        },
        {
          id: 'masters.uom', label: 'Unit of Measure', ref: '§3.13', type: 'list', roles: ['superadmin'],
          filters: [['Active', 'Inactive', 'All Statuses'], ['Used — Any', 'Yes', 'No']], filterNames: ['Status', 'Used'],
          columns: [{ k: 'name', t: 'Unit', c: 'cell-strong' }, { k: 'code', t: 'Code', c: 'mono' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'used', t: 'Used', type: 'status' }],
          rows: () => D.masters.uom, empty: 'No units configured.', actions: [{ label: '+ Add Unit', primary: 1 , go: 'masters.uom.add' }]
        },
        {
          id: 'masters.ticketcategories', label: 'Ticket Categories', ref: '§3.14', type: 'list', roles: ['superadmin'],
          filters: [['Active', 'Inactive', 'All Statuses'], ['Used — Any', 'Yes', 'No']], filterNames: ['Status', 'Used'],
          columns: [{ k: 'name', t: 'Ticket Category', c: 'cell-strong' }, { k: 'code', t: 'Code', c: 'mono' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'used', t: 'Used', type: 'status' }],
          rows: () => D.masters.ticketCategories, empty: 'No ticket categories configured.', actions: [{ label: '+ Add Category', primary: 1 , go: 'masters.ticketcategories.add' }]
        },
        {
          id: 'masters.customerstatus', label: 'Customer Status', ref: '§3.15', type: 'list', roles: ['superadmin'],
          filters: [['Active', 'Inactive', 'All Statuses']], filterNames: ['Status'],
          columns: [{ k: 'name', t: 'Customer Status', c: 'cell-strong' }, { k: 'code', t: 'Code', c: 'mono' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'used', t: 'Used', type: 'status' }],
          rows: () => D.masters.customerStatus, empty: 'No customer statuses configured.', actions: [{ label: '+ Add Status', primary: 1 , go: 'masters.customerstatus.add' }]
        },
        {
          id: 'masters.customersource', label: 'Customer Source', ref: '§3.16', type: 'list', roles: ['superadmin'],
          desc: 'Re-added 2026-07-31. Where a customer first came from — the field Sales is asked about before anything else, and what credits an acquisition channel for a won deal.',
          filters: [['Active', 'Inactive', 'All Statuses'], ['Used — Any', 'Yes', 'No']], filterNames: ['Status', 'Used'],
          columns: [{ k: 'name', t: 'Customer Source', c: 'cell-strong' }, { k: 'code', t: 'Code', c: 'mono' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'used', t: 'Used', type: 'status' }],
          rows: () => D.masters.customerSource, empty: 'No customer sources configured.', actions: [{ label: '+ Add Source', primary: 1 , go: 'masters.customersource.add' }]
        },
        {
          id: 'masters.assetcategories', label: 'Asset Categories', ref: '§3.17', type: 'list', roles: ['superadmin'],
          desc: 'Default Useful Life feeds the Straight Line depreciation calculation on each asset record.',
          filters: [['Active', 'Inactive', 'All Statuses'], ['Used — Any', 'Yes', 'No']], filterNames: ['Status', 'Used'],
          columns: [{ k: 'name', t: 'Asset Category', c: 'cell-strong' }, { k: 'code', t: 'Code', c: 'mono' }, { k: 'life', t: 'Default Useful Life (yrs)', c: 'mono r', th: 'r' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'used', t: 'Used', type: 'status' }],
          rows: () => D.masters.assetCategories, empty: 'No asset categories configured.', actions: [{ label: '+ Add Category', primary: 1 , go: 'masters.assetcategories.add' }]
        },
        {
          id: 'masters.employmenttype', label: 'Employment Type', ref: '§3.18', type: 'list', roles: ['superadmin'],
          filters: [['Active', 'Inactive', 'All Statuses'], ['Used — Any', 'Yes', 'No']], filterNames: ['Status', 'Used'],
          columns: [{ k: 'name', t: 'Employment Type', c: 'cell-strong' }, { k: 'code', t: 'Code', c: 'mono' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'used', t: 'Used', type: 'status' }],
          rows: () => D.masters.employmentType, empty: 'No employment types configured.', actions: [{ label: '+ Add Employment Type', primary: 1 , go: 'masters.employmenttype.add' }]
        },
        {
          id: 'masters.insurance', label: 'Insurance Plans', ref: '§3.19', type: 'list', roles: ['superadmin', 'hr'], scope: { hr: 'view' },
          desc: 'Company-provided benefit plans. HR gets View as the natural point of contact for benefits questions, without setting premium or coverage terms.',
          filters: [['Active', 'Inactive', 'All Statuses'], ['All Types', 'Health', 'Life', 'Personal Accident']], filterNames: ['Status', 'Plan Type'],
          columns: [{ k: 'name', t: 'Plan Name', c: 'cell-strong' }, { k: 'type', t: 'Plan Type', type: 'chip' }, { k: 'cover', t: 'Sum Insured', type: 'money', c: 'r', th: 'r' }, { k: 'emp', t: 'Employee Contribution', type: 'money', c: 'r', th: 'r' }, { k: 'company', t: 'Company Contribution', type: 'money', c: 'r', th: 'r' }, { k: 'status', t: 'Status', type: 'status' }],
          rows: () => D.masters.insurance, empty: 'No insurance plans configured.',
          actions: [{ label: '+ Add Plan', primary: 1, roles: ['superadmin'] , go: 'masters.insurance.add' }]
        },
        {
          id: 'masters.email', label: 'Email Configuration', ref: '§3.21', type: 'record', roles: ['superadmin'], record: 'emailconfig',
          desc: 'Every outbound email this CMS sends — server settings and the per-trigger template list — is configured here, dynamically. Nothing is hardcoded: change the server, or switch a single notification off, without a code change.'
        },
        { id: 'masters.expensetypes.add', navHidden: 1, label: 'Add Expense Type', ref: '§3.3', type: 'form', form: 'm.expensetypes', roles: ['superadmin','manager'], desc: 'Manager can add and edit; Delete and Deactivate stay Super Admin only.' },
        { id: 'masters.leavetypes.add', navHidden: 1, label: 'Add / Edit Leave Type', ref: '§3.4', type: 'form', form: 'm.leavetypes', roles: ['superadmin','manager','hr'], desc: 'Quota, carry-forward cap and encashment rules for one leave type.' },
        { id: 'masters.holidays.add', navHidden: 1, label: 'Add Holiday', ref: '§3.5', type: 'form', form: 'm.holidays', roles: ['superadmin','manager'], desc: 'Mandatory holidays are excluded from working-day counts in Leave and Payroll.' },
        { id: 'masters.holidays.import', navHidden: 1, label: 'Bulk Import Holidays', ref: '§3.5', type: 'form', form: 'm.holidays.import', roles: ['superadmin'], desc: 'Upload an Excel or CSV file to import multiple holidays at once. Duplicates (same date already in the calendar) are skipped with a warning.' },
        { id: 'masters.workweek.add', navHidden: 1, label: 'Add / Edit Work Week Policy', ref: '§3.20a', type: 'form', form: 'm.workweek', roles: ['superadmin'], desc: 'Every number on this form is configurable — hours per day, the unpaid break, the weekly target, the Saturday pattern, the grace window and what a shortfall does to pay. Net Working Hours is derived, never typed.' },
        { id: 'masters.workweek.satrule', navHidden: 1, label: 'Override a Saturday', ref: '§3.20b', type: 'form', form: 'm.satrule', roles: ['superadmin'], desc: 'Flip a single Saturday against the pattern — a one-off working Saturday before a release, or an extra day off. A Mandatory holiday already wins on its own; this is for everything else.' },
        { id: 'masters.paycycle.edit', navHidden: 1, label: 'Edit Pay Cycle', ref: '§3.20c', type: 'form', form: 'm.paycycle', roles: ['superadmin'], desc: 'Start Day and End Day decide what date range a pay period actually covers. An event dated after End Day always rolls into the next period.' },
        { id: 'masters.bank.add', navHidden: 1, label: 'Add Bank Account', ref: '§3.7', type: 'form', form: 'm.bank', roles: ['superadmin'], desc: 'Meshrd\'s own accounts — entirely separate from a vendor\'s own account.' },
        { id: 'masters.paymentmode.add', navHidden: 1, label: 'Add Payment Mode', ref: '§3.8', type: 'form', form: 'm.paymentmode', roles: ['superadmin'], desc: 'The accepted ways a payment can be made or received.' },
        { id: 'masters.department.add', navHidden: 1, label: 'Add Department', ref: '§3.9', type: 'form', form: 'm.department', roles: ['superadmin'], desc: 'The controlled list of departments staff can belong to.' },
        { id: 'masters.designation.add', navHidden: 1, label: 'Add Designation', ref: '§3.10', type: 'form', form: 'm.designation', roles: ['superadmin'], desc: 'The controlled list of job titles staff can hold.' },
        { id: 'masters.hsn.add', navHidden: 1, label: 'Add HSN / SAC Code', ref: '§3.11', type: 'form', form: 'm.hsn', roles: ['superadmin'], desc: 'Applied per line item, not per document.' },
        { id: 'masters.servicecategory.add', navHidden: 1, label: 'Add Service Category', ref: '§3.12', type: 'form', form: 'm.servicecategory', roles: ['superadmin'], desc: 'Meshrd\'s own service lines, for tagging Opportunities, Projects and Invoices.' },
        { id: 'masters.uom.add', navHidden: 1, label: 'Add Unit of Measure', ref: '§3.13', type: 'form', form: 'm.uom', roles: ['superadmin'], desc: 'Controlled units for invoice and quote line items.' },
        { id: 'masters.ticketcategories.add', navHidden: 1, label: 'Add Ticket Category', ref: '§3.14', type: 'form', form: 'm.ticketcategories', roles: ['superadmin'], desc: 'Categories used to classify support tickets.' },
        { id: 'masters.customerstatus.add', navHidden: 1, label: 'Add Customer Status', ref: '§3.15', type: 'form', form: 'm.customerstatus', roles: ['superadmin'], desc: 'The lifecycle states a customer record can be in.' },
        { id: 'masters.customersource.add', navHidden: 1, label: 'Add Customer Source', ref: '§3.16', type: 'form', form: 'm.customersource', roles: ['superadmin'], desc: 'Where a customer first came from — Referral, Website, Cold Outreach, and so on.' },
        { id: 'masters.assetcategories.add', navHidden: 1, label: 'Add Asset Category', ref: '§3.17', type: 'form', form: 'm.assetcategories', roles: ['superadmin'], desc: 'Default Useful Life feeds the Straight Line depreciation calculation.' },
        { id: 'masters.employmenttype.add', navHidden: 1, label: 'Add Employment Type', ref: '§3.18', type: 'form', form: 'm.employmenttype', roles: ['superadmin'], desc: 'The controlled list of employment types staff can be classified under.' },
        { id: 'masters.insurance.add', navHidden: 1, label: 'Add Insurance Plan', ref: '§3.19', type: 'form', form: 'm.insurance', roles: ['superadmin'], desc: 'Company-provided benefit plans. HR gets View only.' },
        { id: 'masters.email.template', navHidden: 1, label: 'Edit Email Template', ref: '§3.21a', type: 'form', form: 'm.emailtemplate', roles: ['superadmin'], desc: 'Enable/disable one trigger and edit its subject line and body, independent of the server settings.' },
        { id: 'masters.email.test', navHidden: 1, label: 'Send Test Email', ref: '§3.21b', type: 'form', form: 'm.emailtest', roles: ['superadmin'], desc: 'Sends one real email through the configured server to confirm it actually delivers, without waiting for a real trigger to fire.' },
        { id: 'masters.company.address', navHidden: 1, label: 'Add Another Address', ref: '§3.6b', type: 'form', form: 'm.company.address', roles: ['superadmin'], desc: 'Only one address can be Primary at a time; the Primary one is what General Info shows as Registered Address.' },
        { id: 'masters.company.prefix', navHidden: 1, label: 'Edit Number Prefix', ref: '§3.6e', type: 'form', form: 'm.company.prefix', roles: ['superadmin'], desc: 'Starting Number locks once any code of that type has been generated; only the prefix and future behaviour can change.' },
        { id: 'masters.taxes.add', navHidden: 1, label: 'Add Tax Head', ref: '§3.2a', type: 'form', form: 'm.tax.head', roles: ['superadmin','accountant'], desc: 'The one structural choice that drives every other field is Applies To (Scope). No tax is named anywhere in the specification.' },
        { id: 'masters.taxes.slab', navHidden: 1, label: 'Tax Head — Slab Bands', ref: '§3.2b', type: 'form', form: 'm.tax.slab', roles: ['superadmin','accountant'], desc: 'Child rows, only when Calculation Method is a Slab type.' },
        { id: 'masters.taxes.split', navHidden: 1, label: 'Tax Head — Split Components', ref: '§3.2c', type: 'form', form: 'm.tax.split', roles: ['superadmin','accountant'], desc: 'Child rows, optional on any head. A head that splits prints one line per component.' },
        { id: 'masters.taxes.scheme', navHidden: 1, label: 'Add Tax Scheme', ref: '§3.2d', type: 'form', form: 'm.tax.scheme', roles: ['superadmin','accountant'], desc: 'Schemes are optional — if none exist, employees see no scheme choice at all.' },
        { id: 'masters.taxes.relief', navHidden: 1, label: 'Tax Head — Relief Rules', ref: '§3.2e', type: 'form', form: 'm.tax.relief', roles: ['superadmin','accountant'], desc: 'Child rows, optional, income-tax scopes only.' }
      ]
    },
    {
      group: 'Administration', id: 'rbac', label: 'Roles & Access', icon: 'rbac', ref: 'Module 14',
      screens: [
        {
          id: 'rbac.roles', label: 'Role Directory', ref: '§4.1', type: 'list', roles: ['superadmin'],
          desc: 'Five roles today, built so a sixth could be added later without restructuring. Roles themselves are not created or deleted from this screen.',
          filters: [['Has Overrides — Any', 'Yes', 'No']], filterNames: ['Has Overrides'],
          columns: [{ k: 'role', t: 'Role Name', c: 'cell-strong' }, { k: 'desc', t: 'Default Scope' }, { k: 'people', t: 'People Count', c: 'mono r', th: 'r' }, { k: 'overrides', t: 'Override Count', c: 'mono r', th: 'r' }],
          rows: 'rbacRoles', rowGo: 'rbac.matrix', empty: 'No roles configured.'
        },
        { id: 'rbac.matrix', label: 'Role Permission Matrix', ref: '§4.2', type: 'matrix', roles: ['superadmin'], desc: 'The core screen. Four layers per screen: Visible/Hidden, action permissions, field-level toggles, and All/Team/Own scope.' },
        {
          id: 'rbac.overrides', label: 'Individual Permission Overrides', ref: '§4.3', type: 'list', roles: ['superadmin'],
          desc: 'Where a specific person gets extra permission, or has one taken away, without touching anyone else who shares their role.',
          filters: [['All Employees'].concat(PEOPLE), ['All Roles', 'Super Admin', 'Manager', 'Accountant', 'HR', 'Employee'], ['All Modules', 'Employee', 'Payroll', 'Ticket', 'Masters', 'Customer', 'Project'], ['All Types', 'Granted', 'Revoked']],
          filterNames: ['Employee', 'Role', 'Module', 'Override Type'],
          columns: [{ k: 'emp', t: 'Employee', c: 'cell-strong', avatar: 1 }, { k: 'role', t: 'Role', type: 'chip' }, { k: 'module', t: 'Module' }, { k: 'screen', t: 'Screen' }, { k: 'perm', t: 'Permission' }, { k: 'type', t: 'Type', type: 'status' }, { k: 'by', t: 'Granted By' }, { k: 'on', t: 'Date', c: 'mono' }],
          rows: 'overrides', empty: 'No individual overrides in place.',
          actions: [{ label: '+ Add Override', primary: 1 , go: 'rbac.addoverride' }], rowActions: ['Revoke']
        },
        {
          id: 'rbac.log', label: 'Permission Change Log', ref: '§4.4', type: 'list', roles: ['superadmin'],
          desc: 'Every permission change, who made it, and what it was before. Append-only.',
          filters: [['All Change Types', 'Screen visibility', 'Action permission', 'Field toggle', 'Scope restriction'], ['All Users', 'Ravi Shankar'], FIN_PRESETS],
          filterNames: ['Change Type', 'Changed By', 'Period'],
          columns: [{ k: 'when', t: 'When', c: 'mono' }, { k: 'who', t: 'Changed By', c: 'cell-strong' }, { k: 'what', t: 'Change Type', type: 'chip' }, { k: 'target', t: 'Target' }, { k: 'from', t: 'From', type: 'status' }, { k: 'to', t: 'To', type: 'status' }, { k: 'scope', t: 'Applied To' }],
          rows: 'permLog', empty: 'No permission changes recorded.'
        },
        { id: 'rbac.addoverride', navHidden: 1, label: 'Add Permission Override', ref: '§4.3', type: 'form', form: 'r.override', roles: ['superadmin'], desc: 'Grants or revokes one permission for one person, without touching their role default.' }
      ]
    },
    {
      group: 'Administration', id: 'settings', label: 'Settings', icon: 'settings', single: true,
      screens: [{ id: 'settings', label: 'Settings', ref: 'Prototype', type: 'settings', roles: ['superadmin'], desc: 'Appearance, regional and system preferences. Super Admin only.' }]
    }
  ];

  /* ---- nav badges per role ---- */
  const BADGES = {
    'leave.approvals': { manager: 5, hr: 7, superadmin: 7 },
    'ticket.list': { employee: 3, manager: 23, superadmin: 23 },
    'asset.requests': { manager: 2, superadmin: 2 },
    'exp.approvals': { accountant: 4, superadmin: 4 },
    'emp.docqueue': { hr: 6, superadmin: 6 },
    'inv.list': { accountant: { n: 7, hot: 1 }, superadmin: { n: 7, hot: 1 } },
    'inv.cnlist': { accountant: 1, superadmin: 1 }
  };

  window.CMS = { ROLES: ROLES, ALL: ALL, BADGE: BADGE, MODULES: MODULES, BADGES: BADGES, D: D, PEOPLE: PEOPLE, CUSTOMERS: CUSTOMERS, VENDORS: VENDORS, DEPTS: DEPTS, FIN_PRESETS: FIN_PRESETS };
})();
