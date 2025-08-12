<?php
session_start();
include('file/header.php');


?>


<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>تفاصيل المنتج</title>
</head>
<style>
    main{
        display: flex;
        flex-wrap:wrap;
    }
    .container{
        width: 90%;
        height: auto;
        margin:20px auto;
        border-radius:8px;
    }
    .product_img{
        float:left;
        display: flex;
        flex-wrap:wrap;
        margin-bottom:20px;

    }
   .product_img img{
        width: 400px;
        height: 400px;
        margin-left: 40px;
        margin-bottom:20px;
     }
    .product_info{
        float: right;
        width: 400px;
        height: 400px;
        text-align: center;
        font-size:20px;
        margin-right:50px;
        padding:10px 10px;
        margin-top:30px;

    }
        .product_title{
            margin: 10px 0;
        }
    .product_price{
         color:#e67e22;
         margin:10px 0;
            }

   .product_description{
    font-size:16px;
    line-height: 1.5;
   }
  .add_cart{
    width: 150px;
    height:35px;
    margin-left:30px;
    padding:10px 10px;
    background-color: #fff;
    border-radius:5px;
  }
  .add_cart:hover{
        background-color:#e67e22;

  }
 .recently_added{
    float:right;
    width: 30%;
    margin-top:30px;
    border-radius:8px;
    padding:10px 10px;
    box-shadow: 0 5px 10px rgba(0,0,0,1.5);

}
.added_img img{
    float:right;
    margin:10px 10px;
    width: 70px;
    height:70px;
    margin-right:5px;
    border-radius:10px;
}
.comment_infomation{
    float:left;
    width: 50%;
    height:auto;
    margin:20px 10px;
    box-shadow:0 2px 2px rgba(0,0,0,1.0);
}
h5{
    font-size:20px;
    margin-top:20px;
    text-align:center;
    color:black;
}
textarea{
    text-align:center;
    width: 80%;
    margin-top:20px;
    margin-left:50px;
    margin-bottom:10px;
    padding:10px;
    border:1px solid #ccc;
    border-radius:10px;
    height: 50px;


}
.add_comment{
    width: 100px;
    height:35px;
    margin-left:40px;
    padding:10px 10px;
    background-color:#fff;
    border-radius:5px;
}
.add_comment:hover{
background-color:#e67e22;

}
.comments{
margin-top:10px;
}
.comment{
    color:black;
    font-size:larger;
    margin:5px 5px;
    text-align:center;
    padding:10px;
    background-color: #fff;
    border: 1px solid #ddd;
    margin-bottom:10px;
     border-radius:5px;
     overflow:hidden;
     text-overflow:ellipsis;

    
}
a{
    text-decoration:none;
}
.username{
padding:4px 5px;
text-align:right;
color:blue;
font-size:18px;
}
@media screen and (max-width: 700px) {
    .container{
        width: 100%;
    }
    .product_img img{
        width: 80%;
        height: auto;
    }
    .product_info{
        width: 100%;
        margin-right:0;
    }
    .recently_added{
        width: 90%;
        margin-top:20px;
    }
    .comment_infomation{
        width: 100%;
    }
    
}
</style>
<body>
    <main>

    <?php
    $id =$_GET['id'];
if(isset($_GET['id'])) {
    $query ="SELECT *FROM product WHERE id='$id'";
     $result = mysqli_query($conn,$query);
     $row = mysqli_fetch_assoc($result);
} 
    ?>


  <div class="container">
           <div class="product_img">
         <img src="uploads/img//<?php echo $row['proimg'];?>">
           </div>
          <div class="product_info">
             <h1 class="product_title"><?php echo $row['proname'];?></h1>
             <h2 class="product_price"><?php echo $row['proprice'];?>$ &nbsp; السعر</h2>
              <div class="product_section">
      <a href="section.php?section=<?php echo $row ['prosection'];?>"><?php echo $row['prosection'];?></a></div>
             <h3><?php echo $row['prosize'];?> &nbsp; : المقاسات المتوفره </h3>
             <h4 class="product_description">تفاصيل المنتج</h4>
             <p><?php echo $row['prodescript'];?></p>
              <div class="qty_input">
              <button class="qty_count_mins">-</button>
              <input class="t" type="number"  id="quantity" name="" value="1" min="0" max="7"/>
              <button class="qty_count_add" type="submit">+</button>
           </div><br/>
                    <div class="submit" ><a href="">
                     <button class="add_cart" type="submit" name="">ارسال</button>
                    </a>
                    </div>

            
      </div>
  </div>
    </main>
   
    <hr>

    <div class="container">
        <div class="recently_added">
            <h4>منتجات حديثه</h4>
             <?php
                $query="SELECT * FROM product WHERE id!='$id' ORDER BY rand() LIMIT 3";
                $result =mysqli_query($conn,$query);
                while($row=mysqli_fetch_assoc($result)){

                

                ?>
            <div class="added_img"><a href="detalis.php?id=<?php echo $row['id']?>">
       <img src="uploads/img//<?php echo $row['proimg'];?>">
               
               
                </a>
            </div>
             <?php
                }
               ?>
        </div>
        
        
            
      
                 <div class="comment_infomation">
                    
                      <?php
                      // اضهار التعليق في قاعدة البيانت
            
             @$comment =$_POST['comment'];
             @$add_comment =$_POST['add_comment'];
             @$product_id =$_GET['id'];
            @$username =$_GET['user_id'] ?? $_SESSION['user_id'];

              if(!isset($_SESSION['user_id'])){
             echo '<script>alert("يجب تسجيل الدخول اولا"); 
                   window.location.href="user/login.php";
                  </script>';
               }
             if(isset($add_comment )){
                if(empty($comment)){    
                    echo '<script> alert(" الرجاء ملى حقل التقييم")</script>';

                 
                
             }else{
                $query=" INSERT INTO comments (comment,user_id,product_id) 
                VALUES('$comment','$username','$product_id')";
                $result=mysqli_query($conn,$query);
             }
            } 
            //اظهار التعليق من قاعدة البانات الى الصفحه

            $query="SELECT *FROM comments WHERE product_id='$product_id' AND user_id='$username'";
            $result=mysqli_query($conn,$query);
               ?>
                     
                    <h5>هل ترغب بتقييم هذا المنتج</h5>
                    <form action="" method="post">
                  <textarea name="comment" id="" placeholder="قيم من هنا"  required ></textarea>
                  <button class="add_comment" type="submit" name="add_comment">ارسال</button>
                       
                    </form>
                    <h5>تقييمات العملاء</h5>
                    <div class="comments">
                    <?php
                    if(mysqli_num_rows($result) > 0){
                        while($row=mysqli_fetch_assoc($result)){
                              echo "  <div class='username'>  تقييم بواسطة :&nbsp;" .$row['user_id']. "</div>";
                            echo "  <div class='comment'>" .$row['comment']. "</div>";
                        }
                    }
                        else{
                            echo"لا يوجد تقييمات حتى الان"; 
                        }
                    
                    ?>
                    
                       
                    </div>
                 </div>
   
    </div>
 
           


</body>
</html>