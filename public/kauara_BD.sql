create table user (
user_id int primary key auto_increment,
user_name varchar(30) not null unique key,
user_password varchar(50) not null,
user_fullName varchar(75) not null,
user_bio varchar(200));

create table contact(
contact_id int primary key auto_increment,
contact_email varchar(75) not null unique key,
contact_telephone varchar(2) not null unique key,
foreign_user_id int,
foreign key (foreign_user_id) references user(user_id));

create table post (
post_id int primary key auto_increment,
post_contents varchar(200),
foreign_user_id int,
foreign key (foreign_user_id) references user(user_id));

create table product (
product_id int primary key auto_increment,
product_description varchar(250) not null,
product_price int not null,
foreign_user_id int,
foreign key (foreign_user_id) references user(user_id));

create table photo (
photo_id int primary key auto_increment,
photo_url varchar(255) not null unique key,
foreign_post_id int,
foreign_product_id int,
foreign_user_id int,
foreign key (foreign_post_id) references post(post_id),
foreign key (foreign_product_id) references product(product_id),
foreign key (foreign_user_id) references user(user_id));

create table rating (
rating_id int primary key auto_increment,
rating_value int not null,
foreign_user_id int,
foreign_product_id int,
foreign key (foreign_user_id) references user(user_id),
foreign key (foreign_product_id) references product(product_id));

create table coment (
coment_id int primary key auto_increment,
coment_contents varchar(190) not null,
foreign_user_id int,
foreign_post_id int,
foreign_product_id int,
foreign key (foreign_user_id) references user(user_id),
foreign key (foreign_post_id) references product(product_id),
foreign key (foreign_post_id) references post(post_id));

create table sale (
sale_id int primary key auto_increment,
sale_date date not null,
sale_price int not null,
foreign_user_id int,
foreign key (foreign_user_id) references user(user_id));

create table purchase (
purchase_id int primary key auto_increment,
purchase_date date not null,
purchase_price int not null,
foreign_user_id int,
foreign key (foreign_user_id) references user(user_id));

create table product_sale (
product_sale_id int primary key auto_increment,
foreign_product_id int,
foreign_sale_id int,
foreign key (foreign_product_id) references product(product_id),
foreign key (foreign_sale_id) references sale(sale_id));

create table product_purchase (
product_purchase_id int primary key auto_increment,
foreign_product_id int,
foreign_purchase_id int,
foreign key (foreign_product_id) references product(product_id),
foreign key (foreign_purchase_id) references purchase(purchase_id));

