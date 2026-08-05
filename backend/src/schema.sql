-- iOS Bootcamp schema. Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  phone VARCHAR(30),
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','mentor','volunteer','student') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bootcamps (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(190) NOT NULL,
  description TEXT,
  status ENUM('active','archived') NOT NULL DEFAULT 'active',
  registration_open TINYINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Master directory of known students (the uploaded roster). Global across bootcamps.
CREATE TABLE IF NOT EXISTS roster (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id VARCHAR(60),
  full_name VARCHAR(190) NOT NULL,
  email VARCHAR(190),
  phone VARCHAR(40),
  campus VARCHAR(190),
  test_no VARCHAR(60),
  status VARCHAR(40),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_roster_sid (student_id),
  KEY idx_roster_name (full_name),
  KEY idx_roster_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(190) NOT NULL,
  phone VARCHAR(30),
  college VARCHAR(190),
  branch VARCHAR(120),
  year VARCHAR(30),
  roll_no VARCHAR(60),
  notes TEXT,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  registered_by INT NULL,
  approved_by INT NULL,
  team_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_students_status (status),
  KEY idx_students_team (team_id),
  KEY idx_students_user (user_id),
  CONSTRAINT fk_students_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_students_regby FOREIGN KEY (registered_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_students_appby FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS teams (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  spoc_student_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_teams_spoc (spoc_student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS team_mentors (
  team_id INT NOT NULL,
  mentor_id INT NOT NULL,
  PRIMARY KEY (team_id, mentor_id),
  CONSTRAINT fk_tm_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  CONSTRAINT fk_tm_mentor FOREIGN KEY (mentor_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  skey VARCHAR(80) PRIMARY KEY,
  svalue VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rubrics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(190) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rubric_criteria (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rubric_id INT NOT NULL,
  name VARCHAR(190) NOT NULL,
  max_score INT NOT NULL DEFAULT 10,
  weight INT NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_rc_rubric FOREIGN KEY (rubric_id) REFERENCES rubrics(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rubric_scores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  criteria_id INT NOT NULL,
  student_id INT NOT NULL,
  team_id INT NULL,
  mentor_id INT NOT NULL,
  score DECIMAL(6,2) NULL,
  comment TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_score (criteria_id, student_id, mentor_id),
  CONSTRAINT fk_rs_criteria FOREIGN KEY (criteria_id) REFERENCES rubric_criteria(id) ON DELETE CASCADE,
  CONSTRAINT fk_rs_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_rs_mentor FOREIGN KEY (mentor_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(190) NOT NULL,
  description TEXT,
  due_date DATE NULL,
  file_url VARCHAR(1024) NULL,
  file_name VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS task_feedback (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  team_id INT NOT NULL,
  mentor_id INT NOT NULL,
  feedback TEXT,
  score DECIMAL(6,2) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_fb (task_id, team_id, mentor_id),
  CONSTRAINT fk_tf_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_tf_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  CONSTRAINT fk_tf_mentor FOREIGN KEY (mentor_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS questions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  input_type ENUM('text','textarea','number','file','date','url') NOT NULL DEFAULT 'text',
  audience ENUM('all_students','selected_students','teams','team_spoc') NOT NULL,
  required TINYINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS question_targets (
  question_id INT NOT NULL,
  ref_type ENUM('student','team') NOT NULL,
  ref_id INT NOT NULL,
  PRIMARY KEY (question_id, ref_type, ref_id),
  CONSTRAINT fk_qt_question FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS answers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  question_id INT NOT NULL,
  student_id INT NOT NULL,
  value_text TEXT,
  value_number DECIMAL(18,4),
  file_url VARCHAR(500),
  file_name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_ans (question_id, student_id),
  CONSTRAINT fk_ans_question FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  CONSTRAINT fk_ans_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Certificate templates: a background image (local disk) + positioned dynamic fields.
CREATE TABLE IF NOT EXISTS certificate_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(190) NOT NULL,
  background_path VARCHAR(255) NOT NULL,
  width INT NULL,
  height INT NULL,
  fields JSON NULL,
  is_default TINYINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Issued certificates: one per (student, template); values_json snapshots the field values.
CREATE TABLE IF NOT EXISTS certificates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  template_id INT NOT NULL,
  bootcamp_id INT NULL,
  serial VARCHAR(60) NULL,
  verify_code VARCHAR(40) NULL,
  revoked TINYINT NOT NULL DEFAULT 0,
  values_json JSON NULL,
  issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_cert (student_id, template_id),
  UNIQUE KEY uniq_verify (verify_code),
  CONSTRAINT fk_cert_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_cert_template FOREIGN KEY (template_id) REFERENCES certificate_templates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-team chat. Files live on local disk (file_path) and are removed after 30 days
-- (file_expired flips to 1). Isolation is enforced in code by team_id.
CREATE TABLE IF NOT EXISTS chat_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  team_id INT NOT NULL,
  sender_student_id INT NOT NULL,
  body TEXT NULL,
  file_name VARCHAR(255) NULL,
  file_path VARCHAR(255) NULL,
  file_size BIGINT NULL,
  file_expired TINYINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_chat_team (team_id, id),
  CONSTRAINT fk_chat_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_sender FOREIGN KEY (sender_student_id) REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
